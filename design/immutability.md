# Immutable JSONTag data

1. When parsing jsontag data, each entry is frozen immediately after instantiation.
2. Add a clone method to clone an object (shallow clone)
3. a clone is mutable
4. all objects linking to the original object get cloned as well, and the link updated to the new clone
5. once all updates are done, you can freeze the root object again and it will also freeze all clones
6. identity. Each object should have a clear identity, that is the same over mutations, as well as a static identity that changes with mutations. (one indentity-over-time, one identity-per-version)
7. cleanup. Any object no longer linked should be removed, unless you want automatic versioning. In that case the root objects versions should all be kept, and therefor all objects remain linked.

## Problems

### 4 - all objects linking to the original object get cloned as well

This means that we need an index for each object, containing all other objects linking to it.
We can do this while parsing the JSONTag data, just make a weakmap for all objects, while treewalking the dataset.

### which acl grants apply to objects that are linked more than once?

The simplest solution seems to just use the acl metadata gathered while following the path used.

## existing solutions

- immutable.js
- immer
- redux
