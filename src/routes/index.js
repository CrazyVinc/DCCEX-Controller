import express from 'express';
const router = express.Router();


import rollingStockService from '../services/rollingStock.js';




const rollingStock = rollingStockService.getRollingStock();

router.get('/', (req, res) => {
  res.render('index', { title: 'Home', trains: rollingStock.trains });
});

router.get('/rollingstock', (req, res) => {
  res.render('rollingstock', { title: "Rolling Stock", rollingStock })
})

export default router