import { Router } from "express";
import { postGithubCallGraph } from "../controllers/callGraphController.js";
import { postGithubDependencies } from "../controllers/dependencyController.js";
import { postGithubTree } from "../controllers/githubController.js";
import {
  postGithubCommit,
  postGithubCompare,
  postGithubFileHistory,
  postGithubHistory,
  postGithubHistoryStats,
} from "../controllers/historyController.js";
import { postGithubImpact } from "../controllers/impactController.js";
import { postGithubSchema } from "../controllers/schemaController.js";
import { postGithubWorkflows } from "../controllers/workflowController.js";

const router = Router();

router.post("/github/tree", postGithubTree);
router.post("/github/dependencies", postGithubDependencies);
router.post("/github/workflows", postGithubWorkflows);
router.post("/github/call-graph", postGithubCallGraph);
router.post("/github/history", postGithubHistory);
router.post("/github/commit", postGithubCommit);
router.post("/github/compare", postGithubCompare);
router.post("/github/file-history", postGithubFileHistory);
router.post("/github/history-stats", postGithubHistoryStats);
router.post("/github/impact", postGithubImpact);
router.post("/github/schema", postGithubSchema);

export default router;
