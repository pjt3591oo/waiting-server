const jwt = require('jsonwebtoken');
const config = require('../config');

class TokenService {
  generateAccessToken(userId) {
    const payload = {
      userId,
      type: 'access',
      issuedAt: Date.now()
    };
    
    return jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn
    });
  }

  generateQueueToken(userId) {
    const payload = {
      userId,
      type: 'queue',
      issuedAt: Date.now()
    };
    
    return jwt.sign(payload, config.jwt.secret, {
      expiresIn: `${config.queue.timeoutMinutes}m`
    });
  }

  verifyToken(token) {
    try {
      const decoded = jwt.verify(token, config.jwt.secret);
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

module.exports = new TokenService();