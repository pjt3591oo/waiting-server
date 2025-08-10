# 대기열 서버 (Waiting Queue Server)

트래픽 관리를 위한 대기열 시스템입니다. 동시 접속자 수를 제한하고, 대기 중인 사용자에게 실시간으로 순번을 알려주는 서버입니다.

## 주요 기능

- **대기열 관리**: Redis Sorted Set을 사용한 효율적인 대기열 관리
- **실시간 업데이트**: Socket.io를 통한 실시간 대기 순번 알림
- **토큰 기반 인증**: JWT를 사용한 접근 권한 관리
- **자동 대기열 처리**: 5초마다 자동으로 대기열을 처리하여 사용자 입장
- **동시 접속자 제한**: 설정 가능한 최대 동시 접속자 수

## 기술 스택

- **Backend**: Node.js + Express
- **Queue System**: Redis (Sorted Set)
- **Real-time**: Socket.io
- **Authentication**: JWT
- **Container**: Docker + docker-compose
- **Testing**: Vitest + Testcontainers
- **Code Quality**: ESLint + Prettier

## 시작하기

### 사전 요구사항

- Docker 및 Docker Compose
- Node.js 18+ (로컬 개발 시)

### 설치 및 실행

1. 저장소 클론
```bash
git clone <repository-url>
cd waiting-server
```

2. 환경 변수 설정
```bash
cp .env.example .env
# .env 파일을 열어 필요한 설정 수정
```

3. Docker Compose로 실행
```bash
docker-compose up -d
```

4. 로컬 개발 환경 실행
```bash
npm install
npm run dev
```

### 테스트 페이지 접속

브라우저에서 `http://localhost:3000` 접속하여 대기열 시스템을 테스트할 수 있습니다.

## 테스트

### 테스트 실행

```bash
# 모든 테스트 실행
npm test

# 테스트 UI 모드로 실행
npm run test:ui

# 테스트 커버리지 확인
npm run test:coverage

# 특정 테스트 파일만 실행
npm test queue.controller.test.js
```

### 테스트 구조

- **통합 테스트**: Controller와 실제 Redis를 사용한 전체 흐름 검증
- **Testcontainers**: 실제 Redis 컨테이너를 사용하여 실제 환경과 동일한 테스트

### 의존성 주입 패턴

프로젝트는 테스트 가능성을 높이기 위해 의존성 주입 패턴을 사용합니다:

```javascript
// Service 생성 시 의존성 주입
const queueService = new QueueService(redisClient, config);
const tokenService = new TokenService(config);

// Controller 생성 시 서비스 주입
const queueController = new QueueController(queueService, tokenService, queueProcessor);
```

## API 엔드포인트

### 1. 대기열 참가
```http
POST /api/queue/join
Content-Type: application/json

{
  "userId": "user123",
  "email": "user@example.com",
  "metadata": {}
}
```

**응답 (대기 중)**:
```json
{
  "success": true,
  "data": {
    "status": "waiting",
    "position": 5,
    "totalInQueue": 10,
    "activeUsers": 2,
    "estimatedWaitTime": {
      "seconds": 180,
      "minutes": 3,
      "formatted": "3 minutes"
    },
    "canAccess": false
  }
}
```

**응답 (즉시 활성화)**:
```json
{
  "success": true,
  "data": {
    "status": "active",
    "canAccess": true,
    "activeUsers": 1,
    "accessToken": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

### 2. 대기열 상태 확인
```http
GET /api/queue/status/:userId
```

**응답**:
```json
{
  "success": true,
  "data": {
    "status": "waiting",
    "position": 3,
    "totalInQueue": 10,
    "activeUsers": 100,
    "estimatedWaitTime": {
      "seconds": 60,
      "minutes": 1,
      "formatted": "1 minutes"
    },
    "canAccess": false
  }
}
```

### 3. 토큰 검증
```http
POST /api/queue/verify
Authorization: Bearer <access-token>
```

### 4. 대기열 정보 (관리용)
```http
GET /api/queue/info
```

### 5. 대기열 나가기
```http
DELETE /api/queue/leave/:userId
```

**응답**:
```json
{
  "success": true,
  "data": {
    "removed": true,
    "message": "Successfully left the queue"
  }
}
```

### 6. 대기열 초기화 (관리용)
```http
POST /api/queue/clear
```

## WebSocket 이벤트

### 클라이언트 → 서버

- `join-queue`: 사용자별 실시간 업데이트 수신을 위한 룸 참가

### 서버 → 클라이언트

- `queue-joined`: 대기열 참가 완료
- `queue-update`: 대기 순번 업데이트
- `queue-ready`: 서비스 이용 가능 알림 (access token 포함)
- `queue-left`: 대기열 나가기 완료
- `queue-cleared`: 대기열 초기화 알림

## 환경 변수

| 변수명 | 설명 | 기본값 |
|--------|------|--------|
| PORT | 서버 포트 | 3000 |
| REDIS_HOST | Redis 호스트 | localhost |
| REDIS_PORT | Redis 포트 | 6379 |
| JWT_SECRET | JWT 시크릿 키 | your-secret-key |
| MAX_CONCURRENT_USERS | 최대 동시 접속자 수 | 100 |
| QUEUE_TIMEOUT_MINUTES | 대기열 타임아웃 (분) | 30 |
| CORS_ORIGIN | CORS 허용 오리진 | * |

## 프로젝트 구조

```
waiting-server/
├── src/
│   ├── config/         # 설정 파일
│   ├── controllers/    # 컨트롤러
│   ├── middleware/     # 미들웨어
│   ├── routes/         # 라우트 정의
│   ├── services/       # 비즈니스 로직
│   ├── utils/          # 유틸리티
│   └── index.js        # 진입점
├── tests/
│   ├── controller/     # 컨트롤러 통합 테스트
│   └── helpers/        # 테스트 헬퍼 (Redis 컨테이너)
├── public/             # 정적 파일 (테스트 페이지)
├── docker-compose.yml  # Docker 설정
├── Dockerfile          # Docker 이미지
├── package.json        # 의존성
├── vitest.config.mjs   # Vitest 설정
└── README.md           # 문서
```

## 운영 고려사항

1. **Redis 영속성**: 프로덕션에서는 Redis AOF 활성화 권장
2. **보안**: JWT_SECRET은 반드시 강력한 값으로 변경
3. **모니터링**: 대기열 길이와 처리 속도 모니터링 필요
4. **스케일링**: 여러 인스턴스 운영 시 Redis Pub/Sub 활용 고려
5. **타임아웃**: 사용자가 서비스를 떠났을 때 자동으로 active 상태 해제
6. **즉시 활성화**: 빈 슬롯이 있을 때 새 사용자는 대기 없이 즉시 서비스 이용 가능

## 문서

- [API 상세 문서](./document.md) - 모든 API 엔드포인트와 시스템 로직에 대한 상세 설명

## 라이선스

ISC