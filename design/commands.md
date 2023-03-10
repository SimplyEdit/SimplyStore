# commands (CQRS)

Updates/changes can only be done through commands. It uses a seperate endpoint (POST /update). There is only one process that handles this endpoint.

Each command must have a unique uuid, set by the client. A command is handled asynchronously, when fetching /update you will only get a response like 'command accepted'.

When the command is executed, the client is notified of the result (success or failure). This can be through a server-sent event, or though (long) polling. There should be an extra endpoint for each command, say GET /update/{uuid}

Commands are executed only once, but may be received more than once, this is why the client assigns the uuid. Commands with the same uuid (within a specified time window, say one day) are ignored.

commands are written to the command log. When this log is synced, then a response 'command accepted' is sent.

Each server can/should define its own commands, with as much semantics as possible. So instead of defining simple CRUD commands, a server should have meaningfull commands, with opaque inner workings.

A simple, but wrong, solution would be to implement a generic patch command, which uses jsonpatch. This woiuld allow for atomicity, thus fullfilling ACID requirements, but you cannot deduce from the command what the meaning of the change is. And you cannot change the data structure and command handling and then re-run all commands.

However if you create a data structure for support tickets, you could create a command 'createTicket', which would know what to change and where in the dataset. If the dataset changes, you can change the code in the createTicket command handler in tandem. This avoids most of the problems related to schema changes. And this means there is less need of versioning of the API.

You may still need to have versions of commands, so that if parameters to a command change, you can sense old commands through a version number.

Similarly, the query endpoint will need versioning to handle changes in the dataset structure, as all code is defined on the client side. This may be mitigated somewhat by providing a custom library of semantic methods for the client to use, e.g. `searchTickets(...)`.

Older versions of the query api can be simulated through a transformer, which translates/transforms from/to the new structure.

Commands can change the datastructure, by creating a new immutable root and then starving/stopping the current VM processes and starting new VM processes with the new root.
