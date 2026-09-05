export default class SmokeProgress {
  onStepBegin(_test, _result, step) {
    if (step.category === "test.step") console.log(`Smoke step: ${step.title}`)
  }

  onStepEnd(_test, _result, step) {
    if (step.category === "test.step")
      console.log(`Smoke ${step.error ? "failed" : "passed"}: ${step.title}`)
  }
}
