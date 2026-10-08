// Each unit is independently selectable, even when two dealerships share a manufacturer.
export const BUSINESS_UNITS=[
  {id:'renault',name:'Renault Circular',type:'dealership',color:'#f6cf2e'},
  {id:'renault_centro',name:'Renault Centro',type:'dealership',color:'#d6ae2d'},
  {id:'vw',name:'VW Pesado Castro',type:'dealership',color:'#2563eb'},
  {id:'chevrolet_pesado_castro',name:'Chevrolet Pesado Castro',type:'dealership',color:'#1765c1'},
  {id:'chevy',name:'Chevromax',type:'dealership',color:'#e7a32a'},
  {id:'toyota',name:'Sakura Motors',type:'dealership',color:'#e94c59'},
  {id:'used',name:'Usados Pesado Castro',type:'used',color:'#8861ec'},
  {id:'autos_directos',name:'Autos Directos',type:'used',color:'#41a69c'}
];
export const UNIT_BY_CODE=Object.fromEntries(BUSINESS_UNITS.map(unit=>[unit.id,unit]));
export const CODE_BY_UNIT_NAME=Object.fromEntries(BUSINESS_UNITS.map(unit=>[unit.name,unit.id]));
