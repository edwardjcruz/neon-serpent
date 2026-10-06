import { defineBackend } from '@aws-amplify/backend';
import { Stack } from 'aws-cdk-lib';
import { Effect, Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { EventSourceMapping, StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { poolNotify } from './functions/pool-notify/resource';

const backend = defineBackend({ auth, data, poolNotify });
const roomTable = backend.data.resources.tables['PoolRoom'];

// Expire abandoned pool rooms instead of keeping them forever.
backend.data.resources.cfnResources.amplifyDynamoDbTables['PoolRoom'].timeToLiveAttribute = {
  attributeName: 'expiresAt',
  enabled: true,
};

// Every change to a room (shot, join, reaction) runs pool-notify, which pushes "your turn" alerts.
const streamPolicy = new Policy(Stack.of(roomTable), 'PoolNotifyStreamPolicy', {
  statements: [
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['dynamodb:DescribeStream', 'dynamodb:GetRecords', 'dynamodb:GetShardIterator', 'dynamodb:ListStreams'],
      resources: ['*'],
    }),
  ],
});
backend.poolNotify.resources.lambda.role?.attachInlinePolicy(streamPolicy);
const streamMapping = new EventSourceMapping(Stack.of(roomTable), 'PoolNotifyStreamMapping', {
  target: backend.poolNotify.resources.lambda,
  eventSourceArn: roomTable.tableStreamArn!,
  startingPosition: StartingPosition.LATEST,
  batchSize: 10,
  retryAttempts: 1,
});
streamMapping.node.addDependency(streamPolicy);
