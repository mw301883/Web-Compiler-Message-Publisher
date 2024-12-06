const { GenericContainer, Network } = require('testcontainers');
const axios = require('axios');
const amqp = require('amqplib');
const path = require('path');
const { spawn } = require('child_process');

jest.setTimeout(120000);

const USER = "user";
const PASSWORD = "password";

let rabbitMQContainer;
let springBootBackendContainer;
let serverProcess;
let rabbitmqUrl;
let network;

async function waitForRabbitMQ(rabbitmqUrl, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const connection = await amqp.connect(rabbitmqUrl);
      await connection.close();
      return true;
    } catch (error) {
      console.log('RabbitMQ not ready, retrying...');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  throw new Error('RabbitMQ not ready within timeout period');
}

describe('Integration Test for RabbitMQ and server.js', () => {
  beforeAll(async () => {
    network = await new Network().start();

    rabbitMQContainer = await new GenericContainer('rabbitmq:3-management')
      .withNetwork(network)
      .withExposedPorts(5672, 15672)
      .withEnvironment({
        RABBITMQ_DEFAULT_USER: USER,
        RABBITMQ_DEFAULT_PASS: PASSWORD,
      })
      .start();

    const rabbitmqPort = rabbitMQContainer.getMappedPort(5672);
    rabbitmqUrl = `amqp://${USER}:${PASSWORD}@localhost:${rabbitmqPort}`;

    console.log(`RabbitMQ URL: ${rabbitmqUrl}`);

    await waitForRabbitMQ(rabbitmqUrl);

    const serverPath = path.join(__dirname, '../server.js');
    serverProcess = spawn('node', [serverPath], {
      env: {
        ...process.env,
        RABBITMQ_URL: rabbitmqUrl,
        APP_DOMAIN: 'http://localhost:3001',
      },
      stdio: 'inherit',
    });

    await new Promise(resolve => setTimeout(resolve, 5000));

    springBootBackendContainer = await new GenericContainer('michaelwieczorek/web-compiler:web-compiler-backend')
      .withNetwork(network)
      .withExposedPorts(8080)
      .withEnvironment({
        RABBITMQ_USER: USER,
        RABBITMQ_PASSWORD: PASSWORD,
        RABBITMQ_HOST: rabbitMQContainer.getIpAddress(network.getName()),
        RABBITMQ_PORT: '5672',
      })
      .start();
  });

  afterAll(async () => {
    if (rabbitMQContainer) await rabbitMQContainer.stop();
    if (springBootBackendContainer) await springBootBackendContainer.stop();
    if (serverProcess) serverProcess.kill();

    if (network) await network.stop();
  });

  test('should send a file to the /compile endpoint and receive a response', async () => {
    const testFileContent = `#include <iostream>

  int main() {
      std::cout << "Hello, World!" << std::endl;
      return 0;
  }`;

    try {
      const response = await axios.post(`http://localhost:3001/compile`, {
        file: testFileContent,
      });

      console.log('Server response:', response.data);

      expect(response.status).toBe(200);
      expect(response.data).toBeDefined();
      expect(typeof response.data).toBe('object');
      expect(response.data).toHaveProperty('output');
      expect(typeof response.data.output).toBe('string');
      expect(response.data.output).toContain('Hello, World!');

    } catch (error) {
      console.error('Error during HTTP request to /compile:', error);
      throw error;
    }
  });

  test('should return http status code 400 because of empty file content', async () => {
    const testFileContent = ``;

    try {
      const response = await axios.post(`http://localhost:3001/compile`, {
        file: testFileContent,
      });
      expect(response.status).toBe(400);
    } catch (error) {
      if (error.response) {
        expect(error.response.status).toBe(400);
      } else {
        console.error('Error during HTTP request to /compile:', error);
        throw error;
      }
    }
  });

    test('should timeout if a response is not received within the given time', async () => {
        const longRunningFileContent = `#include <iostream>
        int main() {
            std::this_thread::sleep_for(std::chrono::seconds(60));
            return 0;
        }`;

        try {
          const response = await axios.post(`http://localhost:3001/compile`, {
            file: longRunningFileContent,
          }, {
            timeout: 5000,
          });
          console.log('Server response:', response.data);
        } catch (error) {
          expect(error.message).toContain('timeout');
        }
      });
});
