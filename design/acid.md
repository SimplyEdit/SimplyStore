# JSONTAG REST Server - Commands / CQRS

Why the need for CQRS (Command Query Responsibility Segregation?)

The design of the server is purposely simple. It does away with a seperate database system, instead reading all data in memory, giving access to that data to queries written in javascript, using native javascript objects. This does away with the relational-object impedance mismatch. It does away with SQL and ORM solutions.

However, databases have the nice property that they are ACID compliant. We don't want to lose that. ACID stands for 'Atomicity', 'Consistency', 'Isolation' and 'Durability'. Our server should exhibit these same properties. Isolation is handled by handling each query in a seperate VM, using immutable data. But immutable data also means we need a different mechanism to update data, other than plain javascript.

Why the need for immutable data? This is tied to the ACID requirements. If you have multiple processes working with the same, shared, data, there is a good chance of creating inconsistent data. One process changes the data in some way, while another process tries to change the exact same data. One of these processes will 'win', potentially undoing the other process' change. Imagine you have a shop with an inventory. If product X has 1 item in the inventory, and there are two requests to buy that product being handled by two different processes at the same time, you could end up selling the same item twice.

There are ways around this, using locks and mutexes, but these are notoriously difficult to get right. 

Just using immutable data alone won't solve this problem. Both processes will still see that there is 1 product X in store. But if we only allow updates / changes, through a single sequential process, and we allow for the possibility that a change request can fail, we can solve this problem much easier.

So both processes see that there is one item left in inventory. Both processes now create a command (buyProduct(X)) and send it to the command queue. They both get a unique ID as a result, and they can listen for an update on that ID. But there is only a single command handler, which handles commands on a First In First Out basis. The first buyProduct(X) command succeeds, and the inventory is decreased by 1. The next buyProduct(X) command fails its precondition, the inventory is 0. So it fails. Both processes get an update, one is a success, the other is a failure.

Now as the data is immutable, this is not entirely correct. In fact there is a difference between the client process calling the server, and the server process which only allows you to query the data. The server process can't create a command or listen for updates, only the client can. So when the client receives a success or failure resutl, asynchronously, it can send a new query to the server. The server in the mean time creates a new query handler, with the updated data after the changes from the last commands.

Because changes are only applied using the single process command handler, Atomicity is preserved. Each command is an atomic update, it either succeeds of fails. If it fails, none of the updates are kept, since the immutable data structure root is not updated.

Consistency is preserved. Each query request sees a concistent dataset, it may be slightly out of date, but it is internally consistent. Later queries will see a more up to date version of the data, so in the context of updates, the data is eventually consistent.

Isolation is preserved. Each query runs in its own VM, with its own access to the immutable data. Each command is run seperate from queries and custom javascript. 

Durability is preserved. Each command is first written to a log, then the unique ID of the command is returned. The whole dataset is backup to disk once in a while, with the last command ID that has been processed. A backup can be restored, then all commands after the last processes one can be processed again.

The query handlers can run parallel, since they only have access to immutable data. In fact, each query handler process can use the exact same shared memory, keeping memory usage low.

There is a potential problem that a client sends a command, which the server enters into the command log, but before the command log id can be sent back to the client, the server dies. In that case the client cannot know if the command has been processed into the log. The only option is to send the command again. This means that a command that is meant to be processes once could be processed more than once. Commands must be written to ensure that this does not result in an inconsistent dataset. The easiest way to ensure this is to make sure the client gives each command a unique ID, a UUID. The server will then ignore any subsequent commands with the same id, and send a confirm reply back anyway.

The server must thus keep a log of all processed command id's. This can potentially grow so big as to impact performance, so there needs to be a timelimit on this processed log. We can enforce this by requiring a UUID with a timestamp, so either UUID V1 or V2. Any commands with a UUID older than the timelimit will be denied.
