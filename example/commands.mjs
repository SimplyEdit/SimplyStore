export default {
	addPerson: (dataspace, command, request, meta) => {
		dataspace.people.push(command.value)
		return 'foo'
	}
}