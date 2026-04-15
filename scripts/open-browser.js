const { exec } = require('child_process');
setTimeout(() => {
  exec('start http://localhost:3000');
}, 3000);
