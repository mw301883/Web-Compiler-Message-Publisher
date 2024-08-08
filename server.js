const express = require('express');
const amqp = require('amqplib');

const app = express();
const port = 3001; // Port dla backendowego serwera

// Ręcznie wprowadzone dane logowania RabbitMQ
//const rabbitmqUrl = 'amqp://rabbitmq:rabbitmq@localhost';
const rabbitmqUrl = process.env.RABBITMQ_URL;
const queueName = 'compile_queue'; // Nazwa kolejki

let channel = null;

// Funkcja do nawiązania połączenia z RabbitMQ
async function connectToRabbitMQ() {
  try {
    const connection = await amqp.connect(rabbitmqUrl);
    channel = await connection.createChannel();
    await channel.assertQueue(queueName);
    console.log('Connected to RabbitMQ and queue created');
  } catch (error) {
    console.error('Error connecting to RabbitMQ:', error);
  }
}

connectToRabbitMQ();

// Middleware do obsługi JSON
app.use(express.json());

// Endpoint do wysyłania kodu do RabbitMQ
app.post('/compile', async (req, res) => {
  const { file } = req.body;
  try {
    if (!channel) {
      await connectToRabbitMQ();
    }
    channel.sendToQueue(queueName, Buffer.from(file));
    res.status(200).json({ message: 'File sent to RabbitMQ' });
  } catch (error) {
    console.error('Error sending message to RabbitMQ:', error);
    res.status(500).json({ error: 'Failed to send file to RabbitMQ' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
