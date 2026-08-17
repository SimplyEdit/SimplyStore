import process from 'node:process'
import { getRuntimeEnvironment } from './runtime-environment.mjs'

export async function faultPoint(name, env = process.env) {
	if (getRuntimeEnvironment(env) !== 'test') {
		return false
	}
	if (env.SIMPLYSTORE_FAULT_POINT !== name) {
		return false
	}
	process.kill(process.pid, 'SIGKILL')
	return true
}
