const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand
} = require("@aws-sdk/lib-dynamodb");

require("dotenv").config();

const client = new DynamoDBClient({
  region: process.env.AWS_REGION
});

const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.DYNAMODB_MESSAGES_TABLE;

async function saveMessage(message) {
  const command = new PutCommand({
    TableName: TABLE_NAME,
    Item: message
  });

  await docClient.send(command);
  return message;
}

async function getMessagesByRoom(roomId) {
  const command = new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "roomId = :roomId",
    ExpressionAttributeValues: {
      ":roomId": roomId
    },
    ScanIndexForward: true
  });

  const result = await docClient.send(command);
  return result.Items || [];
}

module.exports = {
  saveMessage,
  getMessagesByRoom
};