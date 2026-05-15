const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand
} = require("@aws-sdk/lib-dynamodb");

require("dotenv").config();

const client = new DynamoDBClient({
  region: process.env.AWS_REGION
});

const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.DYNAMODB_MESSAGES_TABLE;
const SUITES_TABLE_NAME = process.env.DYNAMODB_SUITES_TABLE || TABLE_NAME;
const SUITE_STATUS_TIMESTAMP = "SUITE_STATUS";

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
  return (result.Items || []).filter((item) => item.recordType !== "suiteStatus");
}

function buildSuiteStatusItem({
  suiteId,
  roomId,
  status,
  updatedBy
}) {
  const updatedAt = new Date().toISOString();

  if (process.env.DYNAMODB_SUITES_TABLE) {
    return {
      suiteId,
      roomId: roomId || suiteId,
      status,
      updatedBy,
      updatedAt
    };
  }

  return {
    roomId: suiteId,
    timestamp: SUITE_STATUS_TIMESTAMP,
    recordType: "suiteStatus",
    suiteId,
    status,
    updatedBy,
    updatedAt
  };
}

async function saveSuiteStatus(suiteStatus) {
  const item = buildSuiteStatusItem(suiteStatus);

  const command = new PutCommand({
    TableName: SUITES_TABLE_NAME,
    Item: item
  });

  await docClient.send(command);

  return {
    suiteId: item.suiteId,
    roomId: item.roomId,
    status: item.status,
    updatedBy: item.updatedBy,
    updatedAt: item.updatedAt
  };
}

async function getSuiteStatus(suiteId) {
  const key = process.env.DYNAMODB_SUITES_TABLE
    ? { suiteId }
    : { roomId: suiteId, timestamp: SUITE_STATUS_TIMESTAMP };

  const command = new GetCommand({
    TableName: SUITES_TABLE_NAME,
    Key: key
  });

  const result = await docClient.send(command);

  if (!result.Item) {
    return null;
  }

  return {
    suiteId: result.Item.suiteId,
    roomId: result.Item.roomId,
    status: result.Item.status,
    updatedBy: result.Item.updatedBy,
    updatedAt: result.Item.updatedAt
  };
}

module.exports = {
  saveMessage,
  getMessagesByRoom,
  saveSuiteStatus,
  getSuiteStatus
};
