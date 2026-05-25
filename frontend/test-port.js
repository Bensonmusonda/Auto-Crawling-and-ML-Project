const net = require('net');
const server = net.createServer();
server.on('error', (err) => {
  console.log('Error:', err.message);
  process.exit(1);
});
server.listen(3000, '0.0.0.0', () => {
  console.log('Successfully bound to port 3000');
  server.close();
});
