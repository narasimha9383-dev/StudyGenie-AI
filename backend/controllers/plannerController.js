const plannerService = require("../services/plannerService");

const list = async (req, res, next) => { try { res.json({ success: true, tasks: await plannerService.listTasks(req.user.id, req.query) }); } catch (error) { next(error); } };
const create = async (req, res, next) => { try { res.status(201).json({ success: true, task: await plannerService.createTask(req.user.id, req.body) }); } catch (error) { next(error); } };
const update = async (req, res, next) => { try { res.json({ success: true, task: await plannerService.updateTask(req.params.taskId, req.user.id, req.body) }); } catch (error) { next(error); } };
const remove = async (req, res, next) => { try { res.json({ success: true, ...(await plannerService.deleteTask(req.params.taskId, req.user.id)) }); } catch (error) { next(error); } };
const generate = async (req, res, next) => { try { res.status(201).json({ success: true, ...(await plannerService.generatePlan(req.user.id, req.body)) }); } catch (error) { next(error); } };
const analytics = async (req, res, next) => { try { res.json({ success: true, analytics: await plannerService.getAnalytics(req.user.id) }); } catch (error) { next(error); } };

module.exports = { list, create, update, remove, generate, analytics };
