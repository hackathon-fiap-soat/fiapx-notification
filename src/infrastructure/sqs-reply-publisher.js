'use strict';

const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');

/** Publica NotificationSent/NotificationFailed na saga-replies.fifo (grupo = saga_id, dedup = message_id). */
function sqsReplyPublisher(queueUrl, client = new SQSClient({})) {
  return {
    async publish(envelope) {
      await client.send(new SendMessageCommand({
        QueueUrl: await queueUrl(),
        MessageBody: JSON.stringify(envelope),
        MessageGroupId: envelope.saga_id,
        MessageDeduplicationId: envelope.message_id,
        MessageAttributes: {
          type: { DataType: 'String', StringValue: envelope.type },
          correlation_id: { DataType: 'String', StringValue: envelope.correlation_id },
        },
      }));
    },
  };
}

module.exports = { sqsReplyPublisher };
