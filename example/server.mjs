import SimplyStore from '../src/server.mjs'

SimplyStore.run({
	datafile: process.cwd()+'/data.jsontag',
	commandsFile: process.cwd()+'/commands.mjs',
	commandLog: process.cwd()+'/command-log.jsontag',
})