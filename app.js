const express = require('express');
const AWS = require('aws-sdk');
const winston = require('winston');
require('winston-cloudwatch');
const AWSXRay = require('aws-xray-sdk');
const expressWinston = require('express-winston');
require('dotenv').config(); // Load environment variables from .env

// Configure AWS SDK with region and credentials from .env
AWS.config.update({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const app = express();
app.use(AWSXRay.express.openSegment(process.env.APP_NAME));

// Set up CloudWatch Metrics client
const cloudwatch = new AWS.CloudWatch();

// Function to send custom CloudWatch metrics, including API path and method
function sendMetric(metricName, value, unit = 'Milliseconds', path, method) {
  const params = {
    MetricData: [
      {
        MetricName: metricName,
        Dimensions: [
          {
            Name: 'APIName',
            Value: `${method} ${path}`
          }
        ],
        Unit: unit,
        Value: value
      }
    ],
    Namespace: process.env.NAMESPACE
  };

  cloudwatch.putMetricData(params, (err) => {
    if (err) console.error('CloudWatch Error:', err);
    else console.log(`Metric ${metricName} for ${method} ${path} sent successfully`);
  });
}

// Middleware to measure API latency with path and method details
app.use((req, res, next) => {
  const startTime = process.hrtime(); // Start timer
  res.on('finish', () => {
    const duration = process.hrtime(startTime); // Calculate duration
    const latencyInMs = duration[0] * 1000 + duration[1] / 1e6; // Convert to milliseconds
    sendMetric('Latency', latencyInMs, 'Milliseconds', req.path, req.method); // Send latency metric
  });
  next();
});

// Middleware to count API requests (traffic monitoring) with path and method details
app.use((req, res, next) => {
  sendMetric('RequestCount', 1, 'Count', req.path, req.method); // Send request count metric
  next();
});

// Add a logger to capture request logs and send to CloudWatch
winston.add(new winston.transports.CloudWatch({
  logGroupName: process.env.LOG_GROUP_NAME,
  logStreamName: process.env.LOG_STREAM_NAME,
  awsRegion: process.env.AWS_REGION,
  jsonMessage: true
}));

// Express Winston to log all HTTP requests
app.use(expressWinston.logger({
  winstonInstance: winston,
  meta: true,
  msg: "HTTP {{req.method}} {{req.url}}",
  expressFormat: true,
  colorize: false
}));

// Basic route
app.get('/', (req, res) => {
  res.send('Hello, World!');
});

// New route to throw an error
app.get('/error', (req, res, next) => {
  const error = new Error('This is a deliberate error');
  next(error); // Pass the error to the next middleware
});

// Long-running request (3 minutes)
app.get('/long-running', (req, res) => {
  // Simulate a 3-minute delay (180,000 milliseconds)
  setTimeout(() => {
    res.send('This request took 3 minutes to finish.');
  }, 180000); // 180,000 milliseconds = 3 minutes
});

// Error-handling middleware to log errors and send error count metric
app.use((err, req, res, next) => {
  winston.error(`Error: ${err.message}`);
  
  // Send error count metric to CloudWatch
  sendMetric('ErrorCount', 1, 'Count', req.path, req.method); // Send error count metric
  
  res.status(500).json({ status: 'error', message: err.message });
});

app.use(AWSXRay.express.closeSegment());

app.listen(3000, () => {
  console.log('Server is running on port 3000');
});
