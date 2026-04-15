import express from 'express';

export function createWebRouter({ rollingStockService }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const rollingStock = rollingStockService.getRollingStock();
    res.render('index', { title: 'Home', trains: rollingStock.trains });
  });

  router.get('/rollingstock', (req, res) => {
    const rollingStock = rollingStockService.getRollingStock();
    res.render('rollingstock', { title: 'Rolling Stock', rollingStock });
  });

  return router;
}
