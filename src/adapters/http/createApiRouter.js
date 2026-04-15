import express from 'express';

export function createApiRouter({ rollingStockService, socketService }) {
  const router = express.Router();

  router.get('/health', (req, res) => {
    socketService.emit('routes:health', { at: Date.now() });
    res.json({ ok: true });
  });

  router.post('/addTrain', async (req, res) => {
    const { DCC_ID, Name, Length, Speed, startDelay, Functions, Notes, Meta } = req.body;

    try {
      const result = await rollingStockService.addTrain(DCC_ID, Name, Length, Speed, startDelay, Functions, Notes, Meta);
      res.status(201).json({
        success: true,
        message: 'Train added successfully',
        data: result,
      });
    } catch (error) {
      console.error('Error adding train:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to add train to rolling stock',
        error: error.message,
      });
    }
  });

  return router;
}
