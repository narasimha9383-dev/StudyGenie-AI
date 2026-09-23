const User = require("../models/User");
const Quiz = require("../models/Quiz");
const Flashcard = require("../models/FlashCards");

/*
 * ============================================================
 * Configuration
 * ============================================================
 */

const PERIOD_DAYS = Object.freeze({
  weekly: 7,
  monthly: 30,
});

const VALID_PERIODS = new Set(["weekly", "monthly", "overall"]);

const VALID_SUBJECTS = new Set([
  "all",
  "data structures",
  "dbms",
  "operating systems",
  "computer networks",
  "computer architecture",
]);

/*
 * Points awarded for completed learning activity.
 *
 * These values should remain in one place so the scoring
 * system can be changed without modifying ranking logic.
 */
const POINTS = Object.freeze({
  COMPLETED_QUIZ: 10,
  LEARNED_FLASHCARD: 5,
});

/*
 * ============================================================
 * Validation / Normalization
 * ============================================================
 */

const normalizePeriod = (period) => {
  const normalized = String(period || "weekly")
    .trim()
    .toLowerCase();

  return VALID_PERIODS.has(normalized) ? normalized : "weekly";
};

const normalizeSubject = (subject) => {
  const normalized = String(subject || "all")
    .trim()
    .toLowerCase();

  return VALID_SUBJECTS.has(normalized) ? normalized : "all";
};

/*
 * ============================================================
 * Date Helpers
 * ============================================================
 */

const getPeriodStart = (period, now = new Date()) => {
  if (period === "overall") {
    return null;
  }

  const days = PERIOD_DAYS[period];

  if (!days) {
    return null;
  }

  const start = new Date(now);

  start.setDate(start.getDate() - days);

  return start;
};

const buildDateMatch = (start, end = null) => {
  if (start && end) {
    return {
      createdAt: {
        $gte: start,
        $lt: end,
      },
    };
  }

  if (start) {
    return {
      createdAt: {
        $gte: start,
      },
    };
  }

  return {};
};

/*
 * ============================================================
 * Database Aggregation
 * ============================================================
 */

const aggregateActivity = async (model, start, end, pipeline = []) => {
  return model.aggregate([
    {
      $match: buildDateMatch(start, end),
    },

    ...pipeline,
  ]);
};

/*
 * ============================================================
 * Map Aggregation Results
 * ============================================================
 */

const mapByUser = (rows) => {
  return new Map(rows.map((row) => [String(row._id), row]));
};

/*
 * ============================================================
 * Quiz Activity
 * ============================================================
 */

const getQuizActivity = async (start, end) => {
  return aggregateActivity(Quiz, start, end, [
    {
      $group: {
        _id: "$user",

        completedQuizzes: {
          $sum: 1,
        },

        questionsPracticed: {
          $sum: {
            $size: {
              $ifNull: ["$questions", []],
            },
          },
        },
      },
    },
  ]);
};

/*
 * ============================================================
 * Flashcard Activity
 * ============================================================
 */

const getFlashcardActivity = async (start, end) => {
  return aggregateActivity(Flashcard, start, end, [
    {
      $match: {
        isLearned: true,
      },
    },

    {
      $group: {
        _id: "$user",

        learnedFlashcards: {
          $sum: 1,
        },
      },
    },
  ]);
};

/*
 * ============================================================
 * Build Leaderboard Rows
 * ============================================================
 */

const buildLeaderboardRows = (users, quizActivity, flashcardActivity) => {
  return users.map((user) => {
    const quiz = quizActivity.get(String(user._id)) || {};

    const flashcards = flashcardActivity.get(String(user._id)) || {};

    const questionsPracticed = Number(quiz.questionsPracticed || 0);

    const completedQuizzes = Number(quiz.completedQuizzes || 0);

    const learnedFlashcards = Number(flashcards.learnedFlashcards || 0);

    /*
     * Current scoring model:
     *
     * Completed quiz = 10 points
     * Learned flashcard = 5 points
     *
     * Study hours and accuracy are not calculated yet
     * because there is no dedicated study-session/submission
     * model in the current architecture.
     */
    const points =
      completedQuizzes * POINTS.COMPLETED_QUIZ +
      learnedFlashcards * POINTS.LEARNED_FLASHCARD;

    return {
      userId: user._id,

      name: user.name,

      avatar: user.avatar || "",

      studyHours: null,

      questionsPracticed,

      accuracy: null,

      points,
    };
  });
};

/*
 * ============================================================
 * Calculate Rankings
 * ============================================================
 */

const calculateRankings = async ({
  period,
  users,
  now = new Date(),
  end = null,
}) => {
  const start = getPeriodStart(period, now);

  const [quizRows, flashcardRows] = await Promise.all([
    getQuizActivity(start, end),

    getFlashcardActivity(start, end),
  ]);

  const quizActivity = mapByUser(quizRows);

  const flashcardActivity = mapByUser(flashcardRows);

  const rows = buildLeaderboardRows(users, quizActivity, flashcardActivity);

  /*
   * Users with no learning activity are not
   * shown on the leaderboard.
   */
  return (
    rows
      .filter((row) => row.points > 0)

      /*
       * Ranking priority:
       *
       * 1. Points
       * 2. Questions practiced
       * 3. Name
       */
      .sort(
        (a, b) =>
          b.points - a.points ||
          b.questionsPracticed - a.questionsPracticed ||
          String(a.name).localeCompare(String(b.name)),
      )

      .map((row, index) => ({
        ...row,
        rank: index + 1,
      }))
  );
};

/*
 * ============================================================
 * Previous Period
 * ============================================================
 */

const calculatePreviousPeriod = async ({ period, users }) => {
  if (period === "overall") {
    return [];
  }

  const days = PERIOD_DAYS[period];

  const currentEnd = new Date();

  const previousEnd = new Date(currentEnd);

  previousEnd.setDate(previousEnd.getDate() - days);

  return calculateRankings({
    period,
    users,
    now: previousEnd,
    end: currentEnd,
  });
};

/*
 * ============================================================
 * Public Service
 * ============================================================
 */

/**
 * Get leaderboard.
 *
 * Important:
 * Subject filtering is currently not implemented because
 * Quiz and Flashcard documents do not have a reliable,
 * normalized subject field in the current data model.
 *
 * Therefore we explicitly report:
 *
 *     subjectFilteringAvailable: false
 *
 * instead of pretending that filtering happened.
 */
const getLeaderboard = async ({
  userId,
  period = "weekly",
  subject = "all",
} = {}) => {
  const normalizedPeriod = normalizePeriod(period);

  const normalizedSubject = normalizeSubject(subject);

  /*
   * Fetch only the fields required by the leaderboard.
   */
  const users = await User.find(
    {},
    {
      name: 1,
      avatar: 1,
    },
  ).lean();

  /*
   * Current period.
   */
  const rankings = await calculateRankings({
    period: normalizedPeriod,
    users,
  });

  /*
   * Find the authenticated user's ranking.
   */
  const currentUser =
    rankings.find((row) => String(row.userId) === String(userId)) || null;

  /*
   * Calculate movement against the previous period.
   */
  let movement = null;

  if (currentUser && normalizedPeriod !== "overall") {
    const previousRankings = await calculatePreviousPeriod({
      period: normalizedPeriod,
      users,
    });

    const previousUser = previousRankings.find(
      (row) => String(row.userId) === String(userId),
    );

    if (previousUser) {
      movement = previousUser.rank - currentUser.rank;
    }
  }

  return {
    period: normalizedPeriod,

    /*
     * Subject is returned so the frontend can display
     * the selected filter.
     */
    subject: normalizedSubject,

    /*
     * Do not claim filtering is working when the
     * underlying models do not support it.
     */
    subjectFilteringAvailable: false,

    rankings,

    currentUser: currentUser
      ? {
          ...currentUser,
          movement,
        }
      : null,
  };
};

/*
 * ============================================================
 * Exports
 * ============================================================
 */

module.exports = {
  getLeaderboard,
};
