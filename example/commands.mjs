import JSONTag from '@muze-nl/jsontag'

export default {
    addPerson: (dataspace, command, request, meta) => {
        let person = command.value
        const id = JSONTag.getAttribute(person, 'id')
        if (!meta.index.id.has(id)) {
            dataspace.people.push(person)
            if (person.homeworld) {
                person.homeworld.residents.push(person)
            }
        }
    }
}