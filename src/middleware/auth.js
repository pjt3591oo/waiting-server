const tokenService = require('../services/tokenService');

const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        error: 'No authorization header provided'
      });
    }
    
    const token = authHeader.startsWith('Bearer ') 
      ? authHeader.slice(7) 
      : authHeader;
    
    const { valid, payload, error } = tokenService.verifyToken(token);
    
    if (!valid) {
      return res.status(401).json({
        success: false,
        error: error || 'Invalid token'
      });
    }
    
    // Attach user info to request
    req.user = {
      userId: payload.userId,
      tokenType: payload.type
    };
    
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: 'Authentication failed'
    });
  }
};

module.exports = authMiddleware;