import process from 'node:process'

const runtimeEnvironments = new Set(['production', 'development', 'test'])

export function getRuntimeEnvironment(env = process.env) {
	const runtimeEnvironment = env.SIMPLYSTORE_ENV || 'production'
	if (!runtimeEnvironments.has(runtimeEnvironment)) {
		throw new Error(`Invalid SIMPLYSTORE_ENV: ${runtimeEnvironment}`)
	}
	return runtimeEnvironment
}

export function assertRuntimeEnvironmentConfiguration(env = process.env) {
	const runtimeEnvironment = getRuntimeEnvironment(env)
	if (env.SIMPLYSTORE_FAULT_POINT && runtimeEnvironment !== 'test') {
		throw new Error('SIMPLYSTORE_FAULT_POINT is only allowed when SIMPLYSTORE_ENV=test')
	}
}
