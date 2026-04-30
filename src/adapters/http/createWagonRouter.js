import express from 'express';
import multer from 'multer';

export function createWagonRouter({ rollingStockService }) {
  const wagonRouter = express.Router();
  const upload = multer({ storage: multer.memoryStorage() });

  wagonRouter.post('/', async (req, res) => {
    const { Name, Length } = req.body;
    if (typeof Name !== 'string' || !Name.trim()) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }
    const len = Number(Length);
    if (!Number.isFinite(len) || len <= 0) {
      return res.status(400).json({ success: false, message: 'Length must be a positive number' });
    }
    try {
      const created = await rollingStockService.addWagon(Name.trim(), len);
      return res.status(201).json({ success: true, data: created });
    } catch (error) {
      console.error('Error adding wagon:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  });

  wagonRouter.put('/:wagonId', async (req, res) => {
    const { wagonId } = req.params;
    const { Name, Length } = req.body;
    if (typeof Name !== 'string' || !Name.trim()) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }
    const len = Number(Length);
    if (!Number.isFinite(len) || len <= 0) {
      return res.status(400).json({ success: false, message: 'Length must be a positive number' });
    }
    try {
      const updated = await rollingStockService.updateWagon(wagonId, { Name: Name.trim(), Length: len });
      return res.status(200).json({ success: true, data: updated });
    } catch (error) {
      return res.status(404).json({ success: false, message: error.message });
    }
  });

  wagonRouter.delete('/:wagonId', async (req, res) => {
    const { wagonId } = req.params;
    try {
      await rollingStockService.removeWagon(wagonId);
      return res.status(200).json({ success: true, message: 'Wagon removed successfully' });
    } catch (error) {
      return res.status(404).json({ success: false, message: error.message });
    }
  });

  wagonRouter.get('/:wagonId/images', async (req, res) => {
    const { wagonId } = req.params;
    try {
      const images = await rollingStockService.listWagonImages(wagonId);
      return res.status(200).json({ success: true, data: images });
    } catch (error) {
      return res.status(404).json({ success: false, message: error.message });
    }
  });

  wagonRouter.post('/:wagonId/images', upload.single('image'), async (req, res) => {
    const { wagonId } = req.params;
    try {
      const images = await rollingStockService.addWagonImage(wagonId, req.file);
      return res.status(201).json({ success: true, data: images });
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }
  });

  wagonRouter.post('/:wagonId/images/reorder', async (req, res) => {
    const { wagonId } = req.params;
    const { order } = req.body;
    if (!Array.isArray(order)) {
      return res.status(400).json({ success: false, message: 'order must be an array of image file names' });
    }
    try {
      const images = await rollingStockService.reorderWagonImages(wagonId, order);
      return res.status(200).json({ success: true, data: images });
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }
  });

  wagonRouter.post('/:wagonId/images/rename', async (req, res) => {
    const { wagonId } = req.params;
    const { oldName, newName } = req.body;
    if (typeof oldName !== 'string' || typeof newName !== 'string') {
      return res.status(400).json({ success: false, message: 'oldName and newName are required' });
    }
    try {
      const images = await rollingStockService.renameWagonImage(wagonId, oldName, newName);
      return res.status(200).json({ success: true, data: images });
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }
  });

  wagonRouter.delete('/:wagonId/images/:imageName', async (req, res) => {
    const { wagonId, imageName } = req.params;
    try {
      const images = await rollingStockService.removeWagonImage(wagonId, imageName);
      return res.status(200).json({ success: true, data: images });
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }
  });

  return wagonRouter;
}
