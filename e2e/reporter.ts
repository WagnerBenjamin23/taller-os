import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';
// Playwright call logs can contain #invite, confirmation links and form passwords.
// Report only static test/step names and outcomes; no errors, attachments or stdout.
export default class PrivateE2EReporter implements Reporter {
  private phase = 'inicio';
  onStepBegin(_test: TestCase, _result: TestResult, step: TestStep) {
    if (step.category === 'test.step') this.phase = step.title;
  }
  onTestEnd(_test: TestCase, result: TestResult) {
    console.log(`E2E invitación: ${result.status}; fase: ${this.phase}; ${result.duration} ms`);
  }
  onError() {
    console.error('E2E bloqueado: revisar stack Supabase local, servidores y Chromium.');
  }
  onEnd(result: FullResult) {
    console.log(`Gate E2E: ${result.status}`);
  }
}
