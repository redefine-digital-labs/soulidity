// Root Node suites must explicitly mock Electron APIs. This single identity
// prevents a nested desktop installation from bypassing vi.mock('electron').
throw new Error('Electron is not available in root Node tests; provide an explicit vi.mock factory.')

export {}
