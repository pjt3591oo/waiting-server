# 대기열 시스템 API 상세 문서

## 목차
1. [시스템 개요](#시스템-개요)
2. [Redis 데이터 구조](#redis-데이터-구조)
3. [API 엔드포인트](#api-엔드포인트)
4. [핵심 서비스 로직](#핵심-서비스-로직)
5. [WebSocket 이벤트](#websocket-이벤트)
6. [시스템 흐름도](#시스템-흐름도)
7. [설정 및 환경변수](#설정-및-환경변수)

## 시스템 개요

대기열 시스템은 동시 접속자 수를 제한하여 서버 부하를 관리하는 시스템입니다. 사용자는 대기열에 참가하고, 순서가 되면 자동으로 서비스에 접근할 수 있는 토큰을 발급받습니다.

### 주요 컴포넌트

- **Express Server**: RESTful API 제공
- **Redis**: 대기열 데이터 저장 및 관리
- **Socket.io**: 실시간 상태 업데이트
- **JWT**: 접근 권한 토큰 관리
- **Queue Processor**: 5초마다 대기열 자동 처리

## Redis 데이터 구조

### 1. Sorted Set: `waiting:queue`
- **용도**: 대기열 순서 관리
- **구조**: 
  - member: userId
  - score: timestamp (참가 시간)
- **명령어**: ZADD, ZREM, ZRANK, ZRANGE

### 2. Set: `active:users`
- **용도**: 현재 활성 사용자 목록
- **구조**: userId들의 집합
- **명령어**: SADD, SREM, SCARD, SISMEMBER

### 3. Hash: `user:data:{userId}`
- **용도**: 사용자 세부 정보 저장
- **필드**:
  - userId: 사용자 ID
  - queueToken: UUID 토큰
  - joinedAt: 참가 시간
  - email: 이메일 (선택)
  - metadata: 추가 데이터 (JSON)
- **TTL**: 30분 (설정 가능)

## API 엔드포인트

### 1. POST /api/queue/join - 대기열 참가

대기열에 새로운 사용자를 추가합니다.

#### 요청
```http
POST /api/queue/join
Content-Type: application/json

{
  "userId": "user123",
  "email": "user@example.com",
  "metadata": {
    "source": "web",
    "plan": "premium"
  }
}
```

#### 처리 로직

```mermaid
flowchart TD
    A[요청 수신] --> B{userId 존재?}
    B -->|No| C[400 에러]
    B -->|Yes| D[현재 상태 확인]
    D --> E{이미 대기 중?}
    E -->|Yes| F[현재 상태 반환]
    E -->|No| G{이미 활성?}
    G -->|Yes| H[새 토큰 발급]
    G -->|No| I[대기열 추가]
    I --> J[Redis Hash 저장]
    J --> K[Sorted Set 추가]
    K --> L[위치 계산]
    L --> M[WebSocket 알림]
    M --> N[즉시 처리 시도]
    N --> O[응답 반환]
```

#### 상세 처리 단계

1. **입력 검증**
   ```javascript
   if (!userId) {
     return res.status(400).json({
       success: false,
       error: 'userId is required'
     });
   }
   ```

2. **중복 확인**
   - `getQueueStatus(userId)` 호출
   - 이미 waiting 상태면 현재 정보 반환
   - 이미 active 상태면 새 액세스 토큰만 생성

3. **대기열 추가**
   ```javascript
   // Redis Hash에 사용자 정보 저장
   await redisClient.hSet(`user:data:${userId}`, 
     'userId', userId,
     'queueToken', uuidv4(),
     'joinedAt', Date.now().toString(),
     'email', userData.email || '',
     'metadata', JSON.stringify(userData.metadata || {})
   );
   
   // Sorted Set에 추가 (시간순 정렬)
   await redisClient.zAdd('waiting:queue', {
     score: Date.now(),
     value: userId
   });
   ```

4. **즉시 처리**
   - `processQueue()` 호출
   - 가용 슬롯이 있으면 즉시 활성화

#### 응답
```json
{
  "success": true,
  "data": {
    "userId": "user123",
    "queueToken": "550e8400-e29b-41d4-a716-446655440000",
    "position": 5,
    "estimatedWaitTime": {
      "seconds": 900,
      "minutes": 15,
      "formatted": "15 minutes"
    }
  }
}
```

#### WebSocket 이벤트
- `queue-joined`: 참가 완료 알림
- `queue-ready`: 즉시 처리된 경우 활성화 알림

---

### 2. GET /api/queue/status/:userId - 상태 조회

특정 사용자의 대기열 상태를 조회합니다.

#### 요청
```http
GET /api/queue/status/user123
```

#### 처리 로직

```mermaid
flowchart TD
    A[userId로 조회] --> B[ZRANK로 순위 확인]
    B --> C{대기열에 있음?}
    C -->|Yes| D[대기 정보 계산]
    C -->|No| E[활성 사용자 확인]
    E --> F{활성 상태?}
    F -->|Yes| G[활성 상태 반환]
    F -->|No| H[404 에러]
    D --> I[예상 시간 계산]
    I --> J[응답 반환]
```

#### 상세 처리 단계

1. **대기열 위치 확인**
   ```javascript
   const rank = await redisClient.zRank('waiting:queue', userId);
   const position = rank !== null ? rank + 1 : null;
   ```

2. **상태 판단**
   - position이 null이면 대기열에 없음
   - 활성 사용자 Set 확인: `SISMEMBER active:users userId`
   - 둘 다 없으면 `not_in_queue` 상태

3. **대기 시간 계산**
   ```javascript
   // 배치 번호 = 올림(위치 / 최대 동시 사용자)
   const batchPosition = Math.ceil(position / maxConcurrentUsers);
   // 예상 시간 = 배치 번호 * 평균 서비스 시간
   const seconds = batchPosition * estimatedServiceTimeSeconds;
   ```

#### 응답 - 대기 중
```json
{
  "success": true,
  "data": {
    "status": "waiting",
    "position": 3,
    "totalInQueue": 10,
    "activeUsers": 2,
    "estimatedWaitTime": {
      "seconds": 540,
      "minutes": 9,
      "formatted": "9 minutes"
    },
    "canAccess": false
  }
}
```

#### 응답 - 활성 상태
```json
{
  "success": true,
  "data": {
    "status": "active",
    "canAccess": true
  }
}
```

---

### 3. POST /api/queue/verify - 토큰 검증

발급받은 액세스 토큰의 유효성을 검증합니다.

#### 요청
```http
POST /api/queue/verify
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

#### 처리 로직

```mermaid
flowchart TD
    A[Authorization 헤더 확인] --> B{헤더 존재?}
    B -->|No| C[401 에러]
    B -->|Yes| D[Bearer 토큰 추출]
    D --> E[JWT 검증]
    E --> F{유효한 토큰?}
    F -->|No| G[401 에러]
    F -->|Yes| H[userId 추출]
    H --> I[사용자 상태 확인]
    I --> J{활성 상태?}
    J -->|Yes| K[검증 성공]
    J -->|No| L[검증 실패]
```

#### 인증 미들웨어
```javascript
// 1. 헤더 확인
const authHeader = req.headers.authorization;
if (!authHeader) {
  return res.status(401).json({ error: 'No authorization header' });
}

// 2. 토큰 추출
const token = authHeader.startsWith('Bearer ') 
  ? authHeader.slice(7) 
  : authHeader;

// 3. JWT 검증
const { valid, payload } = tokenService.verifyToken(token);
if (!valid) {
  return res.status(401).json({ error: 'Invalid token' });
}

// 4. 사용자 정보 첨부
req.user = { userId: payload.userId, tokenType: payload.type };
```

#### 응답
```json
{
  "success": true,
  "data": {
    "valid": true,
    "userId": "user123",
    "status": "active"
  }
}
```

---

### 4. DELETE /api/queue/leave/:userId - 대기열 이탈

대기열 또는 활성 상태에서 사용자를 제거합니다.

#### 요청
```http
DELETE /api/queue/leave/user123
```

#### 처리 로직

```mermaid
flowchart TD
    A[userId 확인] --> B{유효한 ID?}
    B -->|No| C[400 에러]
    B -->|Yes| D[대기열에서 제거]
    D --> E[ZREM waiting:queue]
    E --> F[사용자 데이터 삭제]
    F --> G[활성 목록에서 제거]
    G --> H[WebSocket 알림]
    H --> I[대기열 위치 업데이트]
    I --> J[응답 반환]
```

#### 상세 처리 단계

1. **대기열 제거**
   ```javascript
   const removed = await redisClient.zRem('waiting:queue', userId);
   ```

2. **데이터 정리**
   ```javascript
   // 사용자 데이터 삭제
   await redisClient.del(`user:data:${userId}`);
   // 활성 목록에서도 제거
   await redisClient.sRem('active:users', userId);
   ```

3. **알림 및 업데이트**
   - 해당 사용자에게 `queue-left` 이벤트
   - 남은 사용자들의 위치 재계산 및 업데이트

#### 응답
```json
{
  "success": true,
  "data": {
    "removed": true,
    "message": "Successfully left the queue"
  }
}
```

---

### 5. GET /api/queue/info - 대기열 정보

전체 대기열 상태와 통계 정보를 조회합니다.

#### 요청
```http
GET /api/queue/info
```

#### 처리 로직

1. **통계 수집**
   ```javascript
   const queueLength = await redisClient.zCard('waiting:queue');
   const activeUsers = await redisClient.sCard('active:users');
   const availableSlots = maxConcurrentUsers - activeUsers;
   ```

2. **다음 대기자 목록**
   ```javascript
   // 상위 10명 조회
   const queueMembers = await redisClient.zRangeWithScores('waiting:queue', 0, 9);
   ```

#### 응답
```json
{
  "success": true,
  "data": {
    "queueLength": 15,
    "activeUsers": 2,
    "maxConcurrentUsers": 2,
    "availableSlots": 0,
    "nextInQueue": [
      {
        "userId": "user456",
        "position": 1,
        "joinedAt": "2024-08-10T10:30:00.000Z",
        "estimatedWaitTime": {
          "seconds": 180,
          "minutes": 3,
          "formatted": "3 minutes"
        }
      }
    ]
  }
}
```

---

### 6. POST /api/queue/clear - 대기열 초기화

모든 대기열 데이터를 삭제합니다. (관리자 기능)

#### 요청
```http
POST /api/queue/clear
```

#### 처리 로직

```javascript
// 1. 대기열 삭제
await redisClient.del('waiting:queue');

// 2. 활성 사용자 삭제
await redisClient.del('active:users');

// 3. 모든 사용자 데이터 삭제
const keys = await redisClient.keys('user:data:*');
if (keys.length > 0) {
  await redisClient.del(keys);
}

// 4. 전체 알림
io.emit('queue-cleared', { message: 'Queue has been cleared' });
```

#### 응답
```json
{
  "success": true,
  "data": {
    "message": "Queue cleared successfully"
  }
}
```

## 핵심 서비스 로직

### QueueService

#### addToQueue(userId, userData)
```javascript
async addToQueue(userId, userData) {
  const timestamp = Date.now();
  const queueToken = uuidv4();
  
  // 1. 사용자 데이터 저장 (Hash)
  await redisClient.hSet(`user:data:${userId}`, 
    'userId', userId,
    'queueToken', queueToken,
    'joinedAt', timestamp.toString(),
    'email', userData.email || '',
    'metadata', JSON.stringify(userData.metadata || {})
  );
  
  // 2. TTL 설정
  await redisClient.expire(`user:data:${userId}`, timeoutMinutes * 60);
  
  // 3. 대기열 추가 (Sorted Set)
  await redisClient.zAdd('waiting:queue', {
    score: timestamp,
    value: userId
  });
  
  // 4. 위치 및 예상 시간 계산
  const position = await this.getQueuePosition(userId);
  
  return {
    userId,
    queueToken,
    position,
    estimatedWaitTime: this.calculateWaitTime(position)
  };
}
```

#### processQueue()
```javascript
async processQueue() {
  // 1. 가용 슬롯 확인
  const activeUsers = await redisClient.sCard('active:users');
  const availableSlots = maxConcurrentUsers - activeUsers;
  
  if (availableSlots <= 0) return [];
  
  // 2. 대기열에서 사용자 추출 (FIFO)
  const nextUsers = await redisClient.zRange('waiting:queue', 0, availableSlots - 1);
  const processedUsers = [];
  
  for (const userId of nextUsers) {
    // 3. 대기열에서 제거
    await redisClient.zRem('waiting:queue', userId);
    
    // 4. 활성 사용자로 이동
    await redisClient.sAdd('active:users', userId);
    
    // 5. 활성 상태 TTL 설정
    await redisClient.expire(`active:${userId}`, timeoutMinutes * 60);
    
    processedUsers.push(userId);
  }
  
  return processedUsers;
}
```

#### calculateWaitTime(position)
```javascript
calculateWaitTime(position) {
  if (!position) return { seconds: 0, minutes: 0, formatted: '0 seconds' };
  
  // 배치 위치 계산 (몇 번째 그룹인지)
  const batchPosition = Math.ceil(position / maxConcurrentUsers);
  
  // 예상 대기 시간 (초)
  const estimatedSeconds = batchPosition * estimatedServiceTimeSeconds;
  
  return {
    seconds: estimatedSeconds,
    minutes: Math.ceil(estimatedSeconds / 60),
    formatted: this.formatWaitTime(estimatedSeconds)
  };
}
```

### QueueProcessor (백그라운드 작업)

```javascript
class QueueProcessor {
  constructor(io) {
    this.io = io;
    this.processingInterval = null;
  }

  start() {
    // 5초마다 대기열 처리
    this.processingInterval = setInterval(async () => {
      try {
        await this.processQueue();
      } catch (error) {
        console.error('Queue processing error:', error);
      }
    }, 5000);
  }

  async processQueue() {
    // 1. 대기열 처리
    const processedUsers = await queueService.processQueue();
    
    if (processedUsers.length > 0) {
      // 2. 처리된 사용자들에게 알림
      for (const userId of processedUsers) {
        const accessToken = tokenService.generateAccessToken(userId);
        
        this.io.to(`user-${userId}`).emit('queue-ready', {
          status: 'active',
          accessToken,
          message: 'You can now access the service',
          timestamp: new Date().toISOString()
        });
      }
      
      // 3. 대기열 위치 업데이트
      await this.updateQueuePositions();
    }
  }

  async updateQueuePositions() {
    const queueInfo = await queueService.getQueueInfo();
    
    // 각 대기자에게 업데이트된 위치 알림
    for (const user of queueInfo.nextInQueue) {
      this.io.to(`user-${user.userId}`).emit('queue-update', {
        position: user.position,
        estimatedWaitTime: user.estimatedWaitTime,
        timestamp: new Date().toISOString()
      });
    }
  }
}
```

### TokenService

```javascript
class TokenService {
  generateAccessToken(userId) {
    const payload = {
      userId,
      type: 'access',
      issuedAt: Date.now()
    };
    
    return jwt.sign(payload, jwtSecret, { expiresIn: '24h' });
  }

  verifyToken(token) {
    try {
      const decoded = jwt.verify(token, jwtSecret);
      return { valid: true, payload: decoded };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }
}
```

## WebSocket 이벤트

### 클라이언트 → 서버

| 이벤트 | 설명 | 데이터 |
|--------|------|--------|
| `join-queue` | 사용자별 룸 참가 | `userId` |
| `disconnect` | 연결 종료 | - |

### 서버 → 클라이언트

| 이벤트 | 설명 | 데이터 |
|--------|------|--------|
| `queue-joined` | 대기열 참가 완료 | `{ userId, queueToken, position, estimatedWaitTime }` |
| `queue-update` | 대기 위치 업데이트 | `{ position, estimatedWaitTime, timestamp }` |
| `queue-ready` | 서비스 이용 가능 | `{ status, accessToken, message, timestamp }` |
| `queue-left` | 대기열 이탈 완료 | `{ message, timestamp }` |
| `queue-cleared` | 대기열 초기화 | `{ message }` |

## 시스템 흐름도

### 전체 사용자 플로우

```mermaid
sequenceDiagram
    participant U as User
    participant C as Client
    participant S as Server
    participant R as Redis
    participant Q as QueueProcessor
    
    U->>C: 대기열 참가 요청
    C->>S: POST /api/queue/join
    S->>R: 상태 확인
    R-->>S: 상태 정보
    
    alt 이미 대기 중
        S-->>C: 현재 상태 반환
    else 신규 참가
        S->>R: Hash 저장 + Sorted Set 추가
        S->>S: processQueue() 호출
        S->>C: WebSocket: queue-joined
        S-->>C: 대기열 정보 응답
    end
    
    loop 5초마다
        Q->>R: 가용 슬롯 확인
        alt 슬롯 가용
            Q->>R: 대기열에서 추출
            Q->>R: 활성 사용자로 이동
            Q->>S: 토큰 생성
            Q->>C: WebSocket: queue-ready
            Q->>C: WebSocket: queue-update (나머지)
        end
    end
    
    U->>C: 서비스 접근
    C->>S: POST /api/queue/verify
    S->>S: JWT 검증
    S->>R: 활성 상태 확인
    S-->>C: 검증 결과
```

### 상태 전이도

```mermaid
stateDiagram-v2
    [*] --> NotInQueue: 초기 상태
    NotInQueue --> Waiting: POST /join
    Waiting --> Active: processQueue()
    Waiting --> NotInQueue: DELETE /leave
    Active --> NotInQueue: DELETE /leave
    Active --> NotInQueue: TTL 만료
    Waiting --> NotInQueue: TTL 만료
```

## 설정 및 환경변수

### 주요 설정값

| 환경변수 | 설명 | 기본값 | 권장 범위 |
|----------|------|--------|-----------|
| `MAX_CONCURRENT_USERS` | 최대 동시 접속자 수 | 100 | 10-1000 |
| `QUEUE_TIMEOUT_MINUTES` | 대기열 타임아웃 | 30 | 10-120 |
| `JWT_SECRET` | JWT 서명 키 | - | 32자 이상 |
| `REDIS_HOST` | Redis 호스트 | localhost | - |
| `REDIS_PORT` | Redis 포트 | 6379 | - |

### 성능 튜닝 가이드

1. **최대 동시 사용자 수 설정**
   - 서버 리소스와 평균 서비스 시간 고려
   - 모니터링을 통해 점진적 조정
   
2. **대기열 처리 주기**
   - 현재 5초 (QueueProcessor)
   - 더 빠른 응답이 필요하면 단축 가능
   - Redis 부하 고려 필요

3. **Redis 최적화**
   - AOF 대신 RDB 사용 검토
   - maxmemory-policy 설정
   - 네트워크 지연 최소화

4. **토큰 만료 시간**
   - 서비스 특성에 맞게 조정
   - 너무 짧으면 재인증 빈번
   - 너무 길면 보안 위험

### 모니터링 포인트

- 대기열 길이 추이
- 평균 대기 시간
- 활성 사용자 수
- Redis 메모리 사용량
- WebSocket 연결 수
- API 응답 시간

### 장애 대응

1. **Redis 연결 실패**
   - 자동 재연결 시도
   - 헬스체크 엔드포인트 모니터링

2. **대량 트래픽**
   - 대기열 길이 제한 고려
   - Rate limiting 적용

3. **메모리 부족**
   - TTL 단축
   - 오래된 데이터 정리 배치