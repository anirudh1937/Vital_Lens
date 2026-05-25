const path = require('path');
const fs = require('fs');

const basePath = path.join(__dirname, '..');

async function main() {
  let aws;
  try {
    aws = require('@aws-sdk/client-s3');
  } catch (e) {
    console.error('Missing dependency: @aws-sdk/client-s3. Run npm install.');
    process.exit(1);
  }

  const configFile = path.join(basePath, 'data', 'aws_s3.json');
  const cfg = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : {};
  const region = (process.env.AWS_REGION || cfg.region || '').trim();
  const bucket = (process.env.AWS_S3_BUCKET || cfg.bucket || '').trim();
  const prefix = (process.env.AWS_S3_PREFIX || cfg.prefix || 'mate-ai').trim();
  const accessKeyId = (process.env.AWS_ACCESS_KEY_ID || cfg.accessKeyId || '').trim();
  const secretAccessKey = (process.env.AWS_SECRET_ACCESS_KEY || cfg.secretAccessKey || '').trim();

  if (!region || !bucket || !accessKeyId || !secretAccessKey) {
    console.error('AWS config missing. Fill data/aws_s3.json or env vars.');
    process.exit(1);
  }

  const files = process.argv.slice(2);
  const defaultFiles = ['data/chats.json', 'data/rag_store.json', 'data/google_profile.json', 'data/user_quota.json'];
  const selected = files.length > 0 ? files : defaultFiles;
  const client = new aws.S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey }
  });

  for (const rel of selected) {
    const full = path.join(basePath, rel);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      console.log(`skip: ${rel}`);
      continue;
    }
    const key = `${prefix}/${String(rel).replace(/\\/g, '/')}`;
    await client.send(
      new aws.PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: fs.createReadStream(full),
        ContentType: 'application/json'
      })
    );
    console.log(`uploaded: s3://${bucket}/${key}`);
  }
}

main().catch((err) => {
  console.error('cloud:push failed:', err.message || err);
  process.exit(1);
});
