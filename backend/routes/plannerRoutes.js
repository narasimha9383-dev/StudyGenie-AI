const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const controller = require("../controllers/plannerController");

const router = express.Router();
router.use(authMiddleware);
router.get("/", controller.list);
router.post("/tasks", controller.create);
router.put("/tasks/:taskId", controller.update);
router.delete("/tasks/:taskId", controller.remove);
router.post("/generate", controller.generate);
router.get("/analytics", controller.analytics);

module.exports = router;
