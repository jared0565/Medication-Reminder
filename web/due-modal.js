(()=>{
  'use strict';
  window.createMedicationDueModal=function createMedicationDueModal(elements){
    const {dialog,title,time,list,instructions}=elements;
    return{
      show(reminder){
        title.textContent=reminder.label;
        time.textContent=reminder.time;
        list.replaceChildren(...reminder.medicines.map(medicine=>{
          const row=document.createElement('li');
          row.textContent=medicine;
          return row;
        }));
        instructions.textContent=reminder.instructions||'';
        if(!dialog.open)dialog.showModal();
      },
      close(){
        if(dialog.open)dialog.close();
      },
    };
  };
})();
