import { isSupportedSourceFile } from "../parser/languageDetector.js";
import { isPrismaSchemaPath } from "./prisma/prismaParser.js";
import { isSqlSchemaPath } from "./sql/sqlParser.js";

/**
 * Schema-source detection (spec section 6).
 *
 * Extension alone decides Prisma and SQL. A JS/JSX/TS/TSX file is only a
 * Mongoose *candidate* at this stage — whether it actually is one depends on
 * its content, checked separately and cheaply (`looksLikeMongooseSource`)
 * before the more expensive Tree-sitter parse ever runs, so a repository's
 * ordinary JavaScript is never misclassified or needlessly parsed as a
 * schema source.
 */
export type SchemaSourceCandidate = "prisma" | "sql" | "mongoose-candidate";

export function classifySchemaSource(path: string): SchemaSourceCandidate | null {
  if (isPrismaSchemaPath(path)) return "prisma";
  if (isSqlSchemaPath(path)) return "sql";
  if (isSupportedSourceFile(path)) return "mongoose-candidate";
  return null;
}
