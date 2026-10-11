// config/env.ts validates these at import time, so they must exist before any
// module under test pulls it in.
process.env.MONGO_URI = 'mongodb://test';
process.env.JWT_SECRET = 'test-access-secret-0123456789abcdef0123';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-fedcba9876543210fedc';
process.env.NODE_ENV = 'test';
