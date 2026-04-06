import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';
import * as path from 'path';

export class ExamItemsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ---------------------------------------------------------------------------
    // DynamoDB Table
    // PAY_PER_REQUEST avoids capacity planning for a challenge workload with
    // unpredictable/bursty traffic; easy to switch to provisioned later.
    // DESTROY removal policy is intentional for a dev/challenge environment so
    // `cdk destroy` leaves no orphaned tables (change to RETAIN for production).
    // ---------------------------------------------------------------------------
    const table = new dynamodb.Table(this, 'ExamItemsTable', {
      tableName: 'ExamItems',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: false, // PITR disabled — cost optimization for dev/challenge; enable for production
    });

    // Separate GSIs for subject and status allow efficient filtered list queries
    // without requiring a full table scan. Each GSI projects ALL attributes so
    // handlers can read full items directly from the index without a second fetch.
    table.addGlobalSecondaryIndex({
      indexName: 'SubjectIndex',
      partitionKey: { name: 'subject', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    table.addGlobalSecondaryIndex({
      indexName: 'StatusIndex',
      partitionKey: { name: 'itemStatus', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ---------------------------------------------------------------------------
    // Lambda helper
    // NodejsFunction bundles TypeScript entry points via esbuild automatically.
    // externalModules: [] ensures aws-sdk v3 is bundled rather than relying on
    // the Lambda runtime layer, which only includes v2 by default on older runtimes.
    // ---------------------------------------------------------------------------
    const createHandlerFunction = (id: string, handlerFile: string, handlerExport: string): nodejs.NodejsFunction => {
      const fn = new nodejs.NodejsFunction(this, id, {
        entry: path.join(__dirname, '../../src/handlers', handlerFile),
        handler: handlerExport,
        runtime: lambda.Runtime.NODEJS_22_X,
        memorySize: 256,
        timeout: cdk.Duration.seconds(30),
        environment: {
          USE_DYNAMODB: 'true',
          DYNAMODB_TABLE_NAME: table.tableName,
          // AWS_REGION is injected automatically by the Lambda runtime — no need to set it manually.
          // DynamoDBStorage reads process.env.AWS_REGION which the runtime provides.
        },
        bundling: {
          minify: true,
          sourceMap: false,
          externalModules: [],
        },
      });

      // Explicit log group: ONE_WEEK retention avoids infinite log accumulation;
      // DESTROY ensures cdk destroy cleans up (otherwise Lambda auto-creates groups are orphaned).
      new logs.LogGroup(this, `${id}LogGroup`, {
        logGroupName: `/aws/lambda/${fn.functionName}`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      return fn;
    };

    // ---------------------------------------------------------------------------
    // Lambda functions — one per handler file, matching the handler export name
    // ---------------------------------------------------------------------------
    const createItemFn    = createHandlerFunction('CreateItemFunction',    'create-item.ts',    'createItemHandler');
    const getItemFn       = createHandlerFunction('GetItemFunction',        'get-item.ts',       'getItemHandler');
    const updateItemFn    = createHandlerFunction('UpdateItemFunction',     'update-item.ts',    'updateItemHandler');
    const listItemsFn     = createHandlerFunction('ListItemsFunction',      'list-items.ts',     'listItemsHandler');
    const createVersionFn = createHandlerFunction('CreateVersionFunction',  'create-version.ts', 'createVersionHandler');
    const getAuditFn      = createHandlerFunction('GetAuditFunction',       'get-audit.ts',      'getAuditHandler');

    // ---------------------------------------------------------------------------
    // IAM grants — least-privilege: write handlers get read+write, read-only
    // handlers get read only, reducing blast radius if a function is compromised
    // ---------------------------------------------------------------------------
    table.grantReadWriteData(createItemFn);
    table.grantReadWriteData(updateItemFn);
    table.grantReadWriteData(createVersionFn);

    table.grantReadData(getItemFn);
    table.grantReadData(listItemsFn);
    table.grantReadData(getAuditFn);

    // ---------------------------------------------------------------------------
    // API Gateway REST API
    // ---------------------------------------------------------------------------
    const api = new apigateway.RestApi(this, 'ExamItemsApi', {
      restApiName: 'exam-items-api',
      description: 'Exam items management REST API',
      deployOptions: {
        stageName: 'prod',
      },
      // Permissive CORS for the challenge; tighten allowOrigins in production
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // Resource tree mirrors the URL structure: /api/items, /api/items/{id}, etc.
    const apiResource      = api.root.addResource('api');
    const itemsResource    = apiResource.addResource('items');
    const itemResource     = itemsResource.addResource('{id}');
    const versionsResource = itemResource.addResource('versions');
    const auditResource    = itemResource.addResource('audit');

    // Wire each route to its Lambda integration
    itemsResource.addMethod('GET',  new apigateway.LambdaIntegration(listItemsFn));
    itemsResource.addMethod('POST', new apigateway.LambdaIntegration(createItemFn));
    itemResource.addMethod('GET',   new apigateway.LambdaIntegration(getItemFn));
    itemResource.addMethod('PUT',   new apigateway.LambdaIntegration(updateItemFn));
    versionsResource.addMethod('POST', new apigateway.LambdaIntegration(createVersionFn));
    auditResource.addMethod('GET',     new apigateway.LambdaIntegration(getAuditFn));

    // ---------------------------------------------------------------------------
    // Stack outputs — surface the deployed URL and resource identifiers so
    // consumers don't need to dig through CloudFormation to find them
    // ---------------------------------------------------------------------------
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway base URL',
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: table.tableName,
      description: 'DynamoDB table name',
    });

    const lambdas: Record<string, lambda.Function> = {
      CreateItem:    createItemFn,
      GetItem:       getItemFn,
      UpdateItem:    updateItemFn,
      ListItems:     listItemsFn,
      CreateVersion: createVersionFn,
      GetAudit:      getAuditFn,
    };

    for (const [name, fn] of Object.entries(lambdas)) {
      new cdk.CfnOutput(this, `${name}FunctionArn`, {
        value: fn.functionArn,
        description: `${name} Lambda function ARN`,
      });
    }
  }
}
