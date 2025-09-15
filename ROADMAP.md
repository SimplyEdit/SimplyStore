# SimplyStore Roadmap

## Version Control and History

SimplyStore already keeps track of changes made to the data. Each command that alters the data, does so by adding a changeset. This is stored as a separate file, with only those objects that have actually changed.

But these files are all merged together upon startup. And after each command, the shared data is updated again. The history is not accessible in queries or commands. You can only access that by reading in the changesets.

To add the option to access historical data in queries, SimplyStore must give you access to those changesets directly. The idea is that the main `data` dataspace, and `meta.index` will only point to the latest data. But each object in the dataspace, and the dataspace itself, will have a pointer to the previous version of that data. This pointer will give information about when it was created, which command caused it, and information in the command itself, like the author and commit message.

Each historical entry can have a similar property that will point to its previous version. This allows you to list all versions of an object, including the commands and thus the author and message that accompanied it.

The root `data` entry, will also have this property. Each previous version will be a complete set of data, at that point in time. To get a list of objects that have actually changed in that version, a new property or method will be added.

The `meta.index.id` will only point to the latest version of objects. You will need to walk through its previous versions for a specific version if you want it. A helper function will be added to do this more easily.

All in this lays the ground work for a user interface that will allow you to time-travel. The default query interface should add a list of versions, with information about the commands. This will be added to `meta`. Selecting a version will switch your query to the correct dataset and re-run it.

## Private and Shared User Workspaces

When version history is available, it becomes much easier to implement custom workspaces. A workspace is a 'branch' from the main dataset, which contains extra changes not available outside the workspace. Any workspace has its own URL for both queries and commands. Commands sent to the workspace will alter data inside that workspace only.

You can mark a workspace private, in which case only you can access it. You can share the workspace with specific other users, given their account names. In which case they will also have access to it. You can limit this to either read-only or full access.

When you are happy with your changes, you can merge them back into the main dataset and close the workspace. The way to do this is to merge all changes from the main dataset into the workspace. If there are any conflicts, SimplyStore will provide a UI to resolve those. Once the workspace is up to date, the changesets can be applied to the main dataset, and the commands added to the main command log and status. This is similar to a git rebase.

A workspace URL will look like this:

```
https://example.com/simplystore/workspace/my-workspace/
```

To this url you can add `query/` for the query interface, and `command/` to send commands.

On disk, each workspace will get its own `data/` folder. The command-log and command-status files will be moved to the data folder, so each workspace will have its own command history.

Each workspace will save its branch-off point, the last command in the main dataset before the workspace was created. Or after an update, the last command before the update was done.

## Default Workbench UI

The current query UI is fairly limited. You cannot call commands, or edit or add commands. With the necessary security checks in place, it should be possible to create a more complete user interface that allows access to the commands, allow you to add or edit them, and test run them in a temporary workspace. You can then just delete the workspace, and be safe that any errors in your commands cannot affect the main dataset.

## Automation

You should be able to setup automated code flows, e.g. once every day do X, set up webhooks (remote URL's to call when certain data changes or commands are called, and the other way around). This allows SimplyStore to become part of a larger system.

