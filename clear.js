import { MongoClient } from 'mongodb';
import dns from 'dns';

dns.setServers(['8.8.8.8', '8.8.4.4']);

const URI = 'mongodb://soil:aEMpmGDFLZdxk3Ns@209.182.233.18:27017/soil';
async function run() {
  const client = new MongoClient(URI);
  await client.connect();
  const db = client.db('soil');

  const collectionsToClear = ['categories', 'products', 'enquiries'];

  for (const collectionName of collectionsToClear) {
    await db.collection(collectionName).deleteMany({});
    console.log(`cleared ${collectionName}`);
  }

  await client.close();
}
run();
