const express = require('express');
const amqp = require('amqplib');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = 3001;

const rabbitmqUrl = process.env.RABBITMQ_URL;
const appDomain = process.env.APP_DOMAIN;
const queueName = 'compile_queue';
const queueResponseName = 'reply_queue';
let channel = null;
let responseQueue = null;
const responsePromises = new Map();

async function connectToRabbitMQ() {
  try {
    const connection = await amqp.connect(rabbitmqUrl);
    channel = await connection.createChannel();
    await channel.assertQueue(queueName);
    responseQueue = await channel.assertQueue(queueResponseName);
    console.log('Connected to RabbitMQ');
    console.log(`Compile Queue Created: ${queueName}`);
    console.log(`Response Queue Created: ${responseQueue.queue}`);

    channel.consume(responseQueue.queue, (msg) => {
      if (msg && msg.properties && msg.properties.correlationId) {
        const correlationId = msg.properties.correlationId;
        if (responsePromises.has(correlationId)) {
          const { resolve, reject, timer } = responsePromises.get(correlationId);
          clearTimeout(timer);
          resolve(msg.content.toString());
          responsePromises.delete(correlationId);
          channel.ack(msg);
        }
      }
    }, { noAck: false });

  } catch (error) {
    console.error('Error connecting to RabbitMQ:', error);
    setTimeout(connectToRabbitMQ, 10000);
  }
}

connectToRabbitMQ();

app.use(cors('*'));
app.use(express.json());

app.post('/compile', (req, res) => {
  const { file } = req.body;
  if (!file) {
    return res.status(400).json({ error: 'No file provided' });
  }

  if (!channel) {
    connectToRabbitMQ().then(() => {
      sendAndReceiveMessage(file, res);
    }).catch(error => {
      console.error('Error connecting to RabbitMQ:', error);
      res.status(500).json({ error: 'Failed to connect to RabbitMQ' });
    });
  } else {
    sendAndReceiveMessage(file, res);
  }
});

function sendAndReceiveMessage(file, res) {
  const correlationId = uuidv4();

  const responsePromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timeout waiting for response'));
    }, 30000);

    responsePromises.set(correlationId, { resolve, reject, timer });
  });

  channel.sendToQueue(queueName, Buffer.from(file), {
    correlationId: correlationId,
    replyTo: responseQueue.queue,
    routingKey: 'rpc_key'
  });

  console.log(`Message sent to queue: ${queueName} with correlationId: ${correlationId}`);

  responsePromise
    .then(response => {
      res.status(200).send(response);
    })
    .catch(error => {
      console.error('Error receiving response from RabbitMQ:', error);
      res.status(500).json({ error: 'Failed to receive response from RabbitMQ' });
    });
}

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
