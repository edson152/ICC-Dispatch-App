
ICC Dispatch System - Advanced Upgrade

New Features:
- Upload goods photos, goods videos, and receipt images
- Dispatch evidence storage
- Invoice edit logs
- Employee capturer tracking

Setup:
1. Run modules/database_upgrade.sql in PostgreSQL.
2. Add in server.js:
   const dispatchRoutes = require('./modules/dispatchRoutes');
   app.use('/', dispatchRoutes);
3. Restart server.

Uploads folders:
/uploads/goods
/uploads/videos
/uploads/receipts
