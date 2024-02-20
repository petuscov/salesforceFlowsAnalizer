/**
 * Este script pretende ampliar la validación estándar que efectúa SF con los flujos como metadatos.
 * SF revisa que todos los items referenciados existan, pero por ejemplo no revisa que:
 *   1. Todos los items sean accesibles (flujo conexo),
 *   2. ni muestra warnings por ops CRUDs dentro de bucles, o llamadas a acciones o subflujos.
 *   3. ni por elementos que no se usan (si son variables y están marcadas como entrada o salida, puede ser que haya que mantenerlas por dependencias).
 */
const fs = require('fs');
const parser = require('xml2json');
setup();

// ¿Extraer a config?
const UNCONECTED_ELEMENTS_EXITCODE = 1;
const CRUD_OPS_INSIDE_LOOP_EXITCODE = 1;
const UNUSED_ELEMENTS_EXITCODE = 0;

if(!process.argv[2]){ console.error('No file specified.'); process.exit(1); }
if(!isFlow(process.argv[2])){ console.error('You must specify one flow to validate.'); process.exit(1); }

const xml = fs.readFileSync(process.argv[2], { encoding: 'utf8', flag: 'r' });
const parsedFlow = JSON.parse(parser.toJson(xml)).Flow;
addReferencesMap(parsedFlow);

// 1. Validar que todos los elementos de conexión estén referenciados. Validación simple, se supera tb si hay un bucle independiente no conectado a la entrada del flujo, pero es escenario muy raro.
const unconnectedElements = getUnconnectedElements(parsedFlow);
if(unconnectedElements.length > 0){ unconnectedElementMessage(unconnectedElements); process.exit(UNCONECTED_ELEMENTS_EXITCODE); }

// 2. Validar operaciones CRUD dentro de bucles (devolver 1, error). Validar también acciones y subflujos. (devolver 0 pero warning)
const crudOpsInsideLoops = getCrudOpsInsideLoops(parsedFlow); 
if(crudOpsInsideLoops.length > 0){ console.error(`CRUD Operations inside loops: ${JSON.stringify(crudOpsInsideLoops)}`); process.exit(CRUD_OPS_INSIDE_LOOP_EXITCODE); }

// 3. Validar elementos que no se usen (variables, constantes, textemplates o fórmulas) si son variables y están marcadas como entrada o salida, puede ser que haya que mantenerlas por dependencias en otros flujos.
const unusedElements = getUnusedElements(parsedFlow);
if(unusedElements > 0){ console.error(`Unused elements in flow: ${JSON.stringify(unusedElements)}`); process.exit(UNUSED_ELEMENTS_EXITCODE); }

// process.exit(0);

/***************/
/**** UTILS ****/
/***************/


// Validación simple, se supera tb si hay un bucle independiente no conectado a la entrada del flujo / flujo "principal", pero es escenario muy raro.
function getUnconnectedElements(parsedFlow){
    const setReferenced = new Set();
    const setElements = new Set();

    // Start
    const initElement = parsedFlow.start.connector?.targetReference;
    if(initElement){
        setReferenced.add(initElement);
        setElements.add(initElement);
    }

    let scheduledPaths = parsedFlow.start.scheduledPaths;
    if(scheduledPaths && !scheduledPaths.length){scheduledPaths = [scheduledPaths];} // Sólo un scheduledPath, y se interpreta como objeto y no como array.
    if(scheduledPaths){
        for(let scheduledPath of scheduledPaths){
            if(scheduledPath.connector?.targetReference){
                setReferenced.add(scheduledPath.connector.targetReference);
                setElements.add(scheduledPath.connector.targetReference);
            }
        }
    }

    for(let elementType in parsedFlow){
        // Flow item: elemento posicionable en flujo.
        if(isFlowItem(elementType, parsedFlow[elementType])){
            // decisions + de una conexión saliente. loops igual. Caminos "por defecto" en caso de error tb se tienen que tener en cuenta. (faultConnector)
            
            let items = parsedFlow[elementType];
            if(!items.length){items = [items];} // Caso en el que sólo hay un único item del tipo que se está comprobando.

            for(let item of items){
                setElements.add(item.name);
                
                var nextElements = getNextElements(item)
                nextElements.forEach(el=>setReferenced.add(el));
            }
            
        }
    }

    return setElements.difference(setReferenced); // Devolvemos aquellos elementos no referenciados por ningún otro.
}

// Validar también acciones y subflujos.
function getCrudOpsInsideLoops(parsedFlow){
    // Cómo saber cuándo finaliza un bucle?. Cómo tener cuidado con decisiones que puedan dividirse? Cómo tener cuidado con bucles anidados?.
    const loopSensibleElements = new Set();
    let loops;
    let toAdd;

    if(parsedFlow.loops){
        loops = parsedFlow.loops;
        if(!loops.length){loops = [loops];} // Convertimos en array para el escenario en el que sólo hay 1.

        var visitedElements = new Set();
        var loopIterationInfo;

        for(let loop of loops){
            loopIterationInfo = iterateInFlowLoop(loop, parsedFlow, visitedElements);
            Array.from(loopIterationInfo.visitedElements).forEach(el=>visitedElements.add(el));
            Array.from(loopIterationInfo.sensibleElements).forEach(el=>loopSensibleElements.add(el));
        }
    }

    return Array.from(loopSensibleElements);
}

function iterateInFlowLoop(loopElement, parsedFlow, visitedElements){
    const sensibleElementNames = ['loops', 'recordCreates', 'recordDeletes', 'recordLookups', 'recordUpdates', 'actionCalls', 'subflows'];
    let loopSensibleElements = new Set();
    let nextElements = [];

    if(!visitedElements.has(loopElement.name)){
        
        visitedElements.add(loopElement.name);
        nextElements = nextElements.concat(loopElement.nextValueConnector.targetReference); // No debería ser necesario comprobar que no estuviesen ya en nextElements, porque comprobamos siempre visitedElements.
        
        while(nextElements.length){

            let nextElement = parsedFlow.referencesMap[nextElements.shift()];

            if(!visitedElements.has(nextElement.name)){
                nextElements = nextElements.concat(getNextElements(nextElement)); // No debería ser necesario comprobar que no estuviesen ya en nextElements, porque comprobamos siempre visitedElements.
                visitedElements.add(nextElement.name);       
                if(sensibleElementNames.includes(nextElement.flowElementType)){ // operación CRUD, bucle o subflujo
                    loopSensibleElements.add(nextElement.name);
                }
            }
        }
    }
    

    return {
        visitedElements: visitedElements,
        sensibleElements: loopSensibleElements
    };
}

// (variables, constantes, textemplates o fórmulas) si son variables y están marcadas como entrada o salida, puede ser que haya que mantenerlas por dependencias en otros flujos.
function getUnusedElements(parsedFlow){
    return [];
}

// FlowItem: elementos conectables / posicionables en flujo.
// Se excluyen metadatos del flujo (nombre, descripción, processMetadataValues, etc) y variables, constantes, textemplates o fórmulas.
function isFlowItem(flowItemName, flowItemInstances){
    if(!flowItemInstances.length) flowItemInstances = [flowItemInstances];

    const flowItemNames = ['actionCalls','assignments', 'decisions', 'loops', 'recordCreates', 'recordDeletes', 'recordLookups', 'recordUpdates', 'screens', 'subflows'];
    var isFlowItem = false;

    if(flowItemNames.includes(flowItemName)){isFlowItem = true;}

    // Para futuros elementos no contemplados que pueda llegar a incluir SF.
    for(var i = 0 ; i < flowItemInstances.length && !isFlowItem ; i++){
        let itemInstance = flowItemInstances[i];
        if((itemInstance.hasOwnProperty('connector') || itemInstance.hasOwnProperty('faultConnector')) && itemInstance.hasOwnProperty('name')){
            isFlowItem = true;
        }
    }

    return isFlowItem;
}

function isFlow(flowLocation){
    let splitted = flowLocation.split('.');
    if(splitted.length < 3) return false;
    if(splitted[splitted.length-2] === 'flow-meta' && splitted[splitted.length-1] === 'xml') return true;
    return false;
}


/*
- warning cuando haya elementos que no se usen 
- Error cuando haya elementos inconexos.
- warning cuando haya consultas o inserciones dentro de un bucle
*/

function unconnectedElementMessage(unconnectedElements){
    console.log('Elementos inconexos: ' + unconnectedElements.join(', ') + '\n(No se accede a ellos desde ningún elemento)\n');
    console.log(
'Pasos cuando haya conflictos en flujos:\n\
    1. Desplegar el flujo en una instancia de desarrollo\n\
    2. Intentar dar formato automático. Si va OK, perfecto, terminar\n\
    3. Si hay conflictos y no deja dar formato automático, guardar nueva versión. Saltarán warnings.\n\
    4. Se resuelven los warnings uniendo todos los items. Principalmente se tendría que deber a desarrollos que se han hecho en paralelo y para los que hay que mantener todo (los responsables deberán ordenar las cosas de la mejor manera posible)\n\
    5. Guardar con formato auto, recuperar y volver a subir a la rama'
    );
}

function setup(){

    /*
    const symmetricDifference = (setA, setB) => {
    
        const diffA = Array.from(setA).filter(x => !setB.has(x));
        const diffB = Array.from(setB).filter(x => !setA.has(x));
    
        return [...diffA, ...diffB];
    };

    Set.prototype.symmetricDifference = function (setB){ return symmetricDifference(this, setB); }
    */

    const difference = (setA, setB) => {
        const a = Array.from(setA);
        const b = Array.from(setB);

        return a.filter(x => !b.includes(x));
    }

    Set.prototype.difference = function (setB){ return difference(this, setB); }

}

function addReferencesMap(flow){
    flow.referencesMap = {};
    let flowItemsArray;

    for(let elementType in flow){
        if(isFlowItem(elementType, flow[elementType])){
            flowItemsArray = flow[elementType];
            if(!flowItemsArray.length){flowItemsArray = [flowItemsArray];}

            for(flowItem of flowItemsArray){
                flowItem.flowElementType = elementType;
                flow.referencesMap[flowItem.name] = flowItem;
            }
        }
    }
}

function getNextElements(flowItem){
    var referenced = new Set();

    if(flowItem.connector?.targetReference){
        referenced.add(flowItem.connector.targetReference);
    }
    if(flowItem.faultConnector?.targetReference){ // Errores
        referenced.add(flowItem.faultConnector.targetReference);
    }

    // Decisiones
    if(flowItem.defaultConnector?.targetReference){
        referenced.add(flowItem.defaultConnector.targetReference);
    }
    if(flowItem.rules){
        let rules = flowItem.rules; 
        if(!flowItem.rules.length){rules = [flowItem.rules];} // Sólo hay una regla, y se interpreta como objeto y no como array.
        for(let rule of rules){
            if(rule.connector?.targetReference){
                referenced.add(rule.connector.targetReference);
            }
        }
    }

    // Bucles
    if(flowItem.nextValueConnector?.targetReference){
        referenced.add(flowItem.nextValueConnector.targetReference);
    }
    if(flowItem.noMoreValuesConnector?.targetReference){
        referenced.add(flowItem.noMoreValuesConnector.targetReference);
    }

    return Array.from(referenced);
}