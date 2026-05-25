const aedes = require('aedes')(); 
const net = require('net'); 
const PORT = Number(process.env.BROKER_PORT || 1883);
const server = net.createServer(aedes.handle); 
server.listen(PORT, () = 
  console.log('Embedded MQTT broker listening on port ' + PORT); 
});
const logId = c = && c.id ? c.id : 'unknown';
aedes.on('client', (client) = 
  console.log('MQTT client connected: ' + logId(client)); 
});
aedes.on('clientDisconnect', (client) = 
  console.log('MQTT client disconnected: ' + logId(client)); 
});
aedes.on('publish', (packet) = 
  if (packet) { 
    if (packet.topic) { 
      const len = packet.payload ? packet.payload.length : 0; 
      console.log('MQTT publish ' + packet.topic + ' (' + len + ' bytes)'); 
    } 
  } 
});
