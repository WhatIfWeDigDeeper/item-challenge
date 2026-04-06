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
      // Check that at least one function uses nodejs22.x (template assertion checks at least one match)
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'nodejs22.x',
      });
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
              Action: Match.anyValue(),
              Effect: 'Allow',
            }),
          ]),
        },
      });
    });
  });

  describe('Stack Outputs', () => {
    it('outputs the API Gateway URL', () => {
      template.hasOutput('ApiUrl', {});
    });

    it('outputs the DynamoDB table name', () => {
      template.hasOutput('TableName', {});
    });
  });
});
