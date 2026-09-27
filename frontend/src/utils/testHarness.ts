/**
 * Minimal test harness — plain TypeScript, no test-framework dependency.
 *
 * Run a suite with:  npx tsx src/utils/<name>.test.ts
 *
 * Tests are queued rather than run on registration, so `report()` can await
 * them in order. Async test bodies are fully awaited: running them eagerly
 * without awaiting would report a pass before the assertions had executed.
 * `report()` throws when anything failed, so the exit code is non-zero.
 */
interface Result {
  label: string;
  error?: string;
}

type TestBody = () => void | Promise<void>;

const queue: Array<{ label: string; body: TestBody }> = [];
const results: Result[] = [];

export function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export function assertEqual(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`Assertion failed: ${message}\n      expected: ${e}\n      actual:   ${a}`);
  }
}

export function test(label: string, body: TestBody): void {
  queue.push({ label, body });
}

export async function report(title: string): Promise<void> {
  for (const { label, body } of queue) {
    try {
      await body();
      results.push({ label });
    } catch (error) {
      results.push({
        label,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(`\n${title}\n`);

  let failed = 0;
  for (const result of results) {
    if (result.error === undefined) {
      console.log(`  ✓ ${result.label}`);
    } else {
      failed += 1;
      console.log(`  ✗ ${result.label}`);
      console.log(`      ${result.error}`);
    }
  }

  console.log(`\n${results.length - failed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error(`${failed} test(s) failed`);
  }
}
