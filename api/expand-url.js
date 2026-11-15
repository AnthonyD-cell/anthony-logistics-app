export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing URL' });

  try {
    const response = await fetch(url, { redirect: 'follow' });
    return res.status(200).json({ expandedUrl: response.url });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to expand short URL' });
  }
}