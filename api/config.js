module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || null
  });
};
