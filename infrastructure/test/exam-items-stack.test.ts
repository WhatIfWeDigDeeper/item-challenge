import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { ExamItemsStack } from '../lib/exam-items-stack.js';

const app = new App();
const stack = new ExamItemsStack(app, 'TestStack');
const template = Template.fromStack(stack);

describe('ExamItemsStack', () => {
  describe('DynamoDB Table', () => {
    it('has correct key schema (PK=id, SK=sk)', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        KeySchema: [
          { AttributeName: 'id', KeyType: 'HASH' },
          { AttributeName: 'sk', KeyType: 'RANGE' },
        ],
      });
    });

    it('has SubjectIndex GSI with correct keys', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({
            IndexName: 'SubjectIndex',
            KeySchema: [
              { AttributeName: 'subject', KeyType: 'HASH' },
              { AttributeName: 'sk', KeyType: 'RANGE' },
            ],
          }),
        ]),
      });
    });

    it('has StatusIndex GSI with correct keys', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({
            IndexName: 'StatusIndex',
            KeySchema: [
              { AttributeName: 'itemStatus', KeyType: 'HASH' },
              { AttributeName: 'sk', KeyType: 'RANGE' },
            ],
          }),
        ]),
      });
    });

    it('uses PAY_PER_REQUEST billing', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        BillingMode: 'PAY_PER_REQUEST',
      });
    });
  });

  describe('Lambda Functions', () => {
    it('creates exactly 6 Lambda functions', () => {
      template.resourceCountIs('AWS::Lambda::Function', 6);
    });

    it('all Lambda functions use Node.js 22.x runtime', () => {
      // hasResourceProperties checks at least one match; we also verify the total count
      // to ensure all 6 functions use the correct runtime (no stragglers using an older runtime).
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'nodejs22.x',
      });
      // Count functions with the correct runtime — must match total Lambda count of 6
      const functions = template.findResources('AWS::Lambda::Function', {
        Properties: { Runtime: 'nodejs22.x' },
      });
      expect(Object.keys(functions).length).toBe(6);
    });
  });

  describe('API Gateway', () => {
    it('creates a REST API', () => {
      template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
    });

    it('creates deployment for prod stage', () => {
      template.hasResourceProperties('AWS::ApiGateway::Stage', {
        StageName: 'prod',
      });
    });
  });

  describe('IAM', () => {
    it('grants DynamoDB access to Lambda functions via IAM policies', () => {
      // Verify IAM policies exist granting DynamoDB actions
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([
                Match.stringLike('dynamodb:*'),
              ]),
              Effect: 'Allow',
            }),
          ]),
        },
      });
    });
  });

  describe('Stack Outputs', () => {
    it('outputs the API Gateway URL', () => {
      template.hasOutput('ApiUrl', {
        Value: Match.anyValue(),
        Description: 'API Gateway base URL',
      });
    });

    it('outputs the DynamoDB table name', () => {
      template.hasOutput('TableName', {
        Value: Match.anyValue(),
        Description: 'DynamoDB table name',
      });
    });
  });
});
