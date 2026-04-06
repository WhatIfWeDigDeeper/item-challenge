#!/usr/bin/env node
import 'aws-cdk-lib/region-info';
import { App } from 'aws-cdk-lib';
import { ExamItemsStack } from '../lib/exam-items-stack.js';

const app = new App();

new ExamItemsStack(app, 'ExamItemsStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  description: 'Exam items management API — Lambda, API Gateway, DynamoDB',
});
