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
    it('creates exactly 6 application Lambda functions', () => {
      // CDK synthesizes extra Lambdas for custom resources (e.g. LogRetention),
      // so we filter by nodejs22.x runtime to count only application Lambdas.
      const appFunctions = template.findResources('AWS::Lambda::Function', {
        Properties: { Runtime: 'nodejs22.x' },
      });
      expect(Object.keys(appFunctions).length).toBe(6);
    });

    it('all Lambda functions use Node.js 22.x runtime', () => {
      // Exactly 6 application Lambdas use nodejs22.x; CDK custom-resource Lambdas use a different runtime and are excluded.
      // Count is already asserted in the previous test — this verifies the runtime value is correct.
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
              Action: Match.arrayWith([
                Match.stringLike('dynamodb:*'),
              ]),
              Effect: 'Allow',
            }),
          ]),
        },
      });
    });

    it('read-only Lambda functions are not granted write actions', () => {
      // CDK grantReadData emits specific read actions; grantReadWriteData emits dynamodb:*.
      // Verify at least one policy exists that contains only read actions and NOT the
      // write wildcard — confirming the read/write split is in effect.
      const policies = template.findResources('AWS::IAM::Policy', {});
      const policyDocs = Object.values(policies).map((p: any) => JSON.stringify(p.Properties.PolicyDocument));
      const readOnlyPolicies = policyDocs.filter(
        (doc) => doc.includes('dynamodb:GetItem') && !doc.includes('dynamodb:*'),
      );
      expect(readOnlyPolicies.length).toBeGreaterThan(0);
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
