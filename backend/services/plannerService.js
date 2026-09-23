const PlannerTask = require("../models/PlannerTask");
const PDF = require("../models/PDF");

const safeDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw Object.assign(new Error("A valid task date is required."), { statusCode: 400 });
  return date;
};

const listTasks = async (userId, query = {}) => {
  const filter = { user: userId };
  if (query.from || query.to) filter.date = {};
  if (query.from) filter.date.$gte = safeDate(query.from);
  if (query.to) filter.date.$lte = safeDate(query.to);
  return PlannerTask.find(filter).sort({ date: 1, startTime: 1 }).lean();
};

const createTask = async (userId, payload = {}) => {
  if (!String(payload.title || "").trim()) throw Object.assign(new Error("Task title is required."), { statusCode: 400 });
  return PlannerTask.create({
    user: userId, title: String(payload.title).trim(), description: String(payload.description || ""), type: payload.type || "study", subject: String(payload.subject || "General"), topic: String(payload.topic || ""), date: safeDate(payload.date), startTime: payload.startTime || "09:00", duration: Number(payload.duration || 45), priority: payload.priority || "medium", resources: Array.isArray(payload.resources) ? payload.resources : [], notes: String(payload.notes || ""),
  });
};

const updateTask = async (taskId, userId, payload = {}) => {
  const updates = {};
  ["title", "description", "type", "subject", "topic", "startTime", "priority", "notes"].forEach((field) => { if (payload[field] !== undefined) updates[field] = payload[field]; });
  ["duration", "actualDuration"].forEach((field) => { if (payload[field] !== undefined) updates[field] = Number(payload[field]); });
  if (payload.date !== undefined) updates.date = safeDate(payload.date);
  if (payload.status !== undefined) {
    updates.status = payload.status;
    if (payload.status === "completed") updates.completedAt = new Date();
  }
  const task = await PlannerTask.findOneAndUpdate({ _id: taskId, user: userId }, { $set: updates }, { returnDocument: "after", runValidators: true }).lean();
  if (!task) throw Object.assign(new Error("Planner task not found."), { statusCode: 404 });
  return task;
};

const deleteTask = async (taskId, userId) => {
  const deleted = await PlannerTask.findOneAndDelete({ _id: taskId, user: userId });
  if (!deleted) throw Object.assign(new Error("Planner task not found."), { statusCode: 404 });
  return { message: "Planner task deleted successfully." };
};

const generatePlan = async (userId, payload = {}) => {
  const days = Math.max(1, Math.min(90, Number(payload.availableDays || 7)));
  const dailyHours = Math.max(.25, Math.min(16, Number(payload.dailyStudyTime || 2)));
  const subjects = (Array.isArray(payload.subjects) ? payload.subjects : []).map((subject) => String(subject).trim()).filter(Boolean);
  const chosenSubjects = subjects.length ? subjects : ["My study materials"];
  const start = safeDate(payload.startDate || new Date());
  const materials = await PDF.find({ user: userId, status: "completed" }).select("_id title").lean();
  const perDay = Math.max(1, Math.floor((dailyHours * 60) / 45));
  const tasks = [];
  for (let day = 0; day < days; day += 1) {
    for (let slot = 0; slot < perDay; slot += 1) {
      const date = new Date(start); date.setDate(date.getDate() + day);
      const subject = chosenSubjects[(day * perDay + slot) % chosenSubjects.length];
      const resource = materials.find((item) => item.title.toLowerCase().includes(subject.toLowerCase().split(" ")[0])) || materials[0];
      tasks.push({ user: userId, title: `${subject} study session`, description: payload.goal || "Build understanding and exam readiness.", type: slot % 2 ? "revision" : "study", subject, topic: "Focused review", date, startTime: `${String(9 + (slot * 2)).padStart(2, "0")}:00`, duration: 45, priority: payload.priority === "weak" ? "high" : "medium", aiGenerated: true, resources: resource ? [{ type: "pdf", resourceId: String(resource._id), title: resource.title }] : [] });
    }
  }
  await PlannerTask.deleteMany({ user: userId, aiGenerated: true, status: { $ne: "completed" } });
  const created = await PlannerTask.insertMany(tasks);
  return { tasks: created, generatedBy: "structured-planner", note: "Tasks were scheduled from your goal, available time, subjects, and processed materials." };
};

const getAnalytics = async (userId) => {
  const tasks = await PlannerTask.find({ user: userId }).select("date duration actualDuration status").lean();
  const plannedMinutes = tasks.reduce((sum, task) => sum + Number(task.duration || 0), 0);
  const completed = tasks.filter((task) => task.status === "completed");
  const actualMinutes = completed.reduce((sum, task) => sum + Number(task.actualDuration || task.duration || 0), 0);
  return { totalTasks: tasks.length, completedTasks: completed.length, completionRate: tasks.length ? Math.round((completed.length / tasks.length) * 100) : 0, plannedMinutes, actualMinutes, plannedHours: Number((plannedMinutes / 60).toFixed(1)), actualHours: Number((actualMinutes / 60).toFixed(1)), averageSessionMinutes: completed.length ? Math.round(actualMinutes / completed.length) : 0, streak: null };
};

module.exports = { listTasks, createTask, updateTask, deleteTask, generatePlan, getAnalytics };
