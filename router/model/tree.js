const express = require('express');
const Lets = require_robinbase('base:Lets');
const Debug = require_robinbase('Debug').prefix('router:tree');

module.exports = function(Model, route, out, buildProcess)
{
    if (!Model.view || !Model.view.tree)
    {
        return null;
    }

    const router = express.Router();
    router.get(`/${route}/tree`, function(req, res, next)
    {
        const processData = buildProcess(req, res);
        const treeDef = typeof Model.view.tree === 'function' ? Model.view.tree() : Model.view.tree;
        const filter = Lets.query(Model, {}, req.query);
        getTopLevelItems(Model, res.locals.authorization, treeDef, filter, function(err, tree)
        {
            if (err)
            {
                return next(err);
            }

            processData.tree = tree;
            processData.context = 'tree';
            processData.isRoot = true;
            processData.dataSource = { tree };
            // this doesn't quite work yet
            // if (Model.view.search === true)
            // {
            //     processData.allowSearch = {modelRoute: Model.view.route, name: Model.view.name, currentSearchTerm: req.query.search || '', searchPath: 'tree'};
            // }

            const template = Model.view.templates && Model.view.templates.tree ? Model.view.templates.tree : 'templates.admin.treeview.tree';

            out(res, template, processData);
        });
    });

    router.get(`/${route}/tree/opendir/:level/:id`, function(req, res, next)
    {
        // make sure we have json output
        res.locals.apiMode = true;

        const processData = buildProcess(req, res, next);
        const treeDef = typeof Model.view.tree === 'function' ? Model.view.tree() : Model.view.tree;
        if (typeof treeDef.path[0].modelKey === 'undefined')
        {
            treeDef.path[0].modelKey = Model.modelKey;
        }

        getSubItems(Model, res.locals.authorization, treeDef, req.params.level, req.params.id, function(err, tree)
        {
            if (err)
            {
                return next(err);
            }



            processData.tree = tree;
            processData.dataSource = { tree };
            // this doesn't quite work yet
            // if (Model.view.search === true)
            // {
            //     processData.allowSearch = {modelRoute: Model.view.route, name: Model.view.name, currentSearchTerm: req.query.search || '', searchPath: 'tree'};
            // }

            res.json(tree);
        });

    });

    return router;
}

module.exports.allowedActions = function(context, authorization, Model, isRoot)
{
    var out = [];
    if (!Model || !modelRoute || !Model.view || !Model.view.tree)
    {
        return out;
    }

    var modelRoute = null;
    if (Model && Model.view)
    {
        modelRoute = Model.view.route;
    }

    if ((isRoot == true) && (context != 'tree'))
    {
        out.push({
            path: `/${modelRoute}/tree`,
            icon: 'fa fa-tree',
            text: 'Tree View',
        });
    }

    return out;
}

function getTopLevelItems(Model, authorization, treeDef, filter, callback)
{
    const treePath = treeDef.path;
    const currentPathDef = treePath[0];
    let rootQuery = currentPathDef.query;
    if (filter && Object.keys(filter).length)
    {
        rootQuery = {$and: [rootQuery, filter]};
    }

    var options={};
    if (typeof currentPathDef.queryOptions != 'undefined')
    {
        options = currentPathDef.queryOptions;
    }
    Model.crud.get(rootQuery, options, authorization, function(err, rootObjs)
    {
        if (err)
        {
            return callback(err, []);
        }

        const mapper = createTreeEntry.bind(null, Model, Model, currentPathDef, 1);
        tree = rootObjs.map(mapper);

        callback(null, tree)
    });
}

function appendTemplate(results, childDef, itemId)
{
    if (typeof childDef.appendTemplate != 'undefined')
    {
        results.push({
            link: '/processes/new/?parentProcess='+itemId,
            icon: childDef.appendTemplate.icon || '',
            openIcon: childDef.appendTemplate.icon || '',
            children: [],
            appendClass: "treeview-append",
            label: childDef.appendTemplate.label || ''
        })
    }
}

function getSubItems(Model, authorization, treeDef, level, itemId, callback)
{
    const config = require_robinbase('config');
    const actions = [];
    let results = [];

    level = parseInt(level);
    const parentLevel = level - 1;
    const parentDef = treeDef.path[parentLevel];
    const childDef = treeDef.path[level];

    Debug.log('level: ', level);
    Debug.log('parentDef: ', parentDef);
    Debug.log('childDef: ', childDef);
    const ParentModel = config.adminModels[parentDef.modelKey];

    const parentLKey = childDef ? childDef.parentLocalKey : null;

    const parentId = ParentModel.schema.props[parentLKey || ParentModel.schema.useId].set(itemId);


    if (childDef)
    {
        actions.push(function(done) {
            const ChildModel = config.adminModels[childDef.modelKey];
            const childAuthorization = authorization && authorization.parent
                ? authorization.parent.getAuthorization(childDef.modelKey)
                : null;

            let query = {[childDef.parentForeignKey]: parentId};
            if (childDef.query)
            {
                query = {$and:[query, childDef.query]};
            }
            Debug.log('COLLECTION:', ChildModel.collection, 'QUERY: ', query);
            let options = {};
            if (typeof childDef.queryOptions != 'undefined')
            {
                options = childDef.queryOptions;
            }
            ChildModel.crud.get(query, options, childAuthorization, function(err, records)
            {
                if (err)
                {
                    return done(err);
                }

                const mapper = createTreeEntry.bind(null, Model, ChildModel, childDef, level + 1);

                results = results.concat(records.map(mapper));

                Debug.log('RECORDS IS?:', results);


                appendTemplate(results, childDef, itemId);

                done(null);
            });
        });
    }

    if (parentDef.recursive)
    {
        actions.push(function(done) {
            const parentAuthorization = authorization && authorization.parent
                ? authorization.parent.getAuthorization(parentDef.modelKey)
                : null;

            let query = {[parentDef.parentForeignKey]: parentId};
            if (parentDef.query)
            {
                query = {$and:[query, parentDef.query]};
            }
            let options = {};
            if (typeof parentDef.queryOptions != 'undefined')
            {
                options = parentDef.queryOptions;
            }

            ParentModel.crud.get(query, options, parentAuthorization, function(err, records)
            {
                if (err)
                {
                    return done(err);
                }

                const mapper = createTreeEntry.bind(null, Model, ParentModel, parentDef, level);

                results = results.concat(records.map(mapper));

                appendTemplate(results, parentDef, itemId);

                done(null);
            });
        });
    }

    if (childDef && childDef.recursive && parentDef.modelKey === childDef.modelKey && treeDef.path[level + 1])
    {
        const subChildDef = treeDef.path[level + 1];
        const SubChildModel = config.adminModels[subChildDef.modelKey]

        actions.push(function(done) {
            const childAuthorization = authorization && authorization.parent
                ? authorization.parent.getAuthorization(subChildDef.modelKey)
                : null;

            let query = {[subChildDef.parentForeignKey]: parentId};
            if (subChildDef.query)
            {
                query = {$and:[query, subChildDef.query]};
            }

            let options = {};
            if (typeof subChildDef.queryOptions != 'undefined')
            {
                options = subChildDef.queryOptions;
            }

            SubChildModel.crud.get(query, options, childAuthorization, function(err, records)
            {
                if (err)
                {
                    return done(err);
                }

                const mapper = createTreeEntry.bind(null, Model, SubChildModel, subChildDef, level + 2);

                results = results.concat(records.map(mapper));

                appendTemplate(results, subChildDef, itemId);

                done(null);
            });
        });
    }

    function iter(index)
    {
        if (typeof actions[index] !== 'function') {
            // todo: sort these things
            return callback(null, results);
        }

        actions[index](function(err) {
            if (err) {
                return callback(err, []);
            }

            process.nextTick(iter, index+1);
        });
    };

    Debug.debug('actions: ', actions);
    iter(0);
}

// function buildDirectoryTree(Model, authorization, treeDef, filter, callback)
// {
//     const config = require_robinbase('config');
//     const treePath = treeDef.path;
//     let loaded = {};
//     let tree = [];
//     let currentSearchIds = [];
//     let stems = [];
//     let pathIndex = 0;
//     let currentPathDef = treePath[0];
//     let rootQuery = currentPathDef.query;
//     let ParentModel = null;
//
//     function iter()
//     {
//         if (currentSearchIds.length === 0 || treePath[pathIndex] == null)
//         {
//             return callback(null, tree);
//         }
//
//         let currentPathDef = treePath[pathIndex];
//         let CurrentModel = config.adminModels[currentPathDef.modelKey];
//         let useQuery = {[currentPathDef.parentLocalKey]: {$in: currentSearchIds}};
//         let useAuthorization = authorization.parent.getAuthorization(currentPathDef.modelKey);
//         loaded[CurrentModel.modelKey] = loaded[CurrentModel.modelKey] || {}
//         if (currentPathDef.query)
//         {
//             useQuery = {$and:[useQuery, currentPathDef.query]};
//         }
//
//
//         CurrentModel.crud.get(useQuery, {}, useAuthorization, function(err, records)
//         {
//             if (err)
//             {
//                 return callback(err, []);
//             }
//
//             // reset it
//             currentSearchIds = [];
//
//             records.forEach(function(record)
//             {
//                 let icon = CurrentModel.view.icon;
//                 if (typeof currentPathDef.icon === "string")
//                 {
//                     icon = currentPathDef.icon;
//                 }
//                 else if (typeof currentPathDef.icon === "function")
//                 {
//                     icon = currentPathDef.icon(record);
//                 }
//
//                 const retVal = {
//                     modelKey: CurrentModel.modelKey,
//                     id: record[CurrentModel.schema.useId],
//                     link: `/${CurrentModel.view.route}/view/${record[CurrentModel.schema.useId]}`,
//                     icon,
//                     children: [],
//                     label: record[currentPathDef.labelKey || CurrentModel.schema.useId]
//                 }
//
//                 if (!loaded[CurrentModel.modelKey][record[CurrentModel.schema.useId]])
//                 {
//                     loaded[CurrentModel.modelKey][record[CurrentModel.schema.useId]] = retVal;
//                     currentSearchIds.push(record[currentPathDef.parentForeignKey || Model.schema.useId]);
//                     loaded[ParentModel.modelKey][record[currentPathDef.parentLocalKey]].children.push(retVal);
//                 }
//             });
//
//             if (currentPathDef.recursive && currentSearchIds.length === 0)
//             {
//                 currentSearchIds = Object.keys(loaded[CurrentModel.modelKey]).map(id => loaded[CurrentModel.modelKey][id].id);
//                 Debug.debug('CURRENT SEARCH IDS: ', currentSearchIds);
//                 pathIndex++;
//             }
//             else if (!currentPathDef.recursive)
//             {
//                 pathIndex++;
//             }
//             else
//             {
//                 Debug.debug('huh', records.length, currentSearchIds);
//             }
//
//             ParentModel = CurrentModel;
//
//             process.nextTick(iter);
//         });
//
//     }
//
//     if (filter && Object.keys(filter).length)
//     {
//         rootQuery = {$and: [rootQuery, filter]};
//     }
//
//
//     Model.crud.get(rootQuery, {}, authorization, function(err, rootObjs)
//     {
//         if (err)
//         {
//             return callback(err, []);
//         }
//
//         loaded[Model.modelKey] = {};
//
//         tree = rootObjs.map(obj => {
//             let icon = Model.view.icon;
//             if (typeof currentPathDef.icon === "string")
//             {
//                 icon = currentPathDef.icon;
//             }
//             else if (typeof currentPathDef.icon === "function")
//             {
//                 icon = currentPathDef.icon(obj);
//             }
//
//             const retVal = {
//                 modelKey: Model.modelKey,
//                 id: obj[Model.schema.useId],
//                 link: `/${Model.view.route}/view/${obj[Model.schema.useId]}`,
//                 icon,
//                 children: [],
//                 label: obj[currentPathDef.labelKey || Model.schema.useId]
//             }
//
//             // so we don't have to iterate twice
//             loaded[Model.modelKey][obj[Model.schema.useId]] = retVal
//             currentSearchIds.push(obj[currentPathDef.parentForeignKey || Model.schema.useId]);
//
//             return retVal;
//         });
//
//
//         if (!currentPathDef.recursive)
//         {
//             pathIndex++;
//         }
//
//         ParentModel = Model;
//
//         process.nextTick(iter);
//     });
// }

function createTreeEntry(Model, CurrentModel, currentPathDef, level, obj)
{
    let icon = CurrentModel.view.icon;
    let openIcon = null;
    let canHaveSubItems = true;

    if (typeof currentPathDef.icon === "string")
    {
        icon = currentPathDef.icon;
    }
    else if (typeof currentPathDef.icon === "function")
    {
        icon = currentPathDef.icon(obj);
    }

    if (typeof currentPathDef.openIcon === 'string')
    {
        openIcon = currentPathDef.openIcon
    }
    else if (typeof currentPathDef.openIcon === 'function')
    {
        openIcon = currentPathDef.openIcon(obj);
    }

    if (typeof currentPathDef.canHaveSubItems === 'boolean')
    {
        canHaveSubItems = currentPathDef.canHaveSubItems;
    }
    else if (typeof currentPathDef.canHaveSubItems === 'function')
    {
        canHaveSubItems = currentPathDef.canHaveSubItems(obj);
    }



    let childrenLink = null;
    if (canHaveSubItems)
    {
        childrenLink = `/${Model.view.route}/tree/opendir/${level}/${obj[currentPathDef.parentLocalKey || CurrentModel.schema.useId]}`;
    }

    const retVal = {
        modelKey: CurrentModel.modelKey,
        id: obj[CurrentModel.schema.useId],
        link: `/${CurrentModel.view.route}/view/${obj[CurrentModel.schema.useId]}`,
        icon,
        openIcon,
        children: [],
        label: obj[currentPathDef.labelKey || CurrentModel.schema.useId],
        level: level,
        childrenLink,
    }

    return retVal;
}
