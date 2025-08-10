const jwt = require('jsonwebtoken');

class TokenService {
  constructor(config) {
    this.config = config;
  }

  generateAccessToken(userId) {
    const payload = {
      userId,
      type: 'access',
      issuedAt: Date.now()
    };
    
    return jwt.sign(payload, this.config.jwt.secret, {
      expiresIn: this.config.jwt.expiresIn
    });
  }

  generateQueueToken(userId) {
    const payload = {
      userId,
      type: 'queue',
      issuedAt: Date.now()
    };
    
    return jwt.sign(payload, this.config.jwt.secret, {
      expiresIn: `${this.config.queue.timeoutMinutes}m`
    });
  }

  verifyToken(token) {
    try {
      const decoded = jwt.verify(token, this.config.jwt.secret);
      return {
        valid: true,
        payload: decoded
      };
    } catch (error) {
      return {
        valid: false,
        error: error.message
      };
    }
  }

  decodeToken(token) {
    return jwt.decode(token);
  }
}

module.exports = TokenService;